package com.airtodrive.usbdrive

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.hardware.usb.UsbConstants
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbManager
import android.net.Uri
import android.os.Environment
import android.os.SystemClock
import android.os.storage.StorageManager
import android.os.storage.StorageVolume
import android.provider.DocumentsContract
import androidx.core.content.ContextCompat
import androidx.core.content.IntentCompat
import androidx.documentfile.provider.DocumentFile
import expo.modules.kotlin.activityresult.AppContextActivityResultLauncher
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean

private const val EXTERNAL_STORAGE_AUTHORITY = "com.android.externalstorage.documents"
private const val PROGRESS_INTERVAL_MS = 250L
private const val BUFFER_SIZE = 256 * 1024

class DownloadOptions : Record {
  @Field val id: String = ""
  @Field val url: String = ""
  @Field val treeUri: String = ""
  @Field val name: String = ""
  @Field val mimeType: String = "application/octet-stream"
}

private class ActiveDownload {
  val cancelled = AtomicBoolean(false)
  val detached = AtomicBoolean(false)
  @Volatile var connection: HttpURLConnection? = null

  fun abort(becauseDetached: Boolean) {
    if (becauseDetached) detached.set(true)
    cancelled.set(true)
    // Closing the socket unblocks a read() that is waiting on the network.
    try {
      connection?.disconnect()
    } catch (_: Exception) {
    }
  }
}

/**
 * Air to Drive USB bridge:
 *  - SAF tree picker for the USB drive root + takePersistableUriPermission
 *  - DocumentFile create / delete on the drive
 *  - URL downloads streamed straight into a DocumentFile output stream
 *  - Detach detection (USB mass-storage unplug / volume unmount) that aborts
 *    every in-flight write and notifies JS so recording stops immediately.
 */
class UsbDriveModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private val downloads = ConcurrentHashMap<String, ActiveDownload>()
  private var receiver: BroadcastReceiver? = null

  @Volatile private var watchedVolumeId: String? = null

  override fun definition() = ModuleDefinition {
    Name("UsbDrive")

    Events("onDriveDetached", "onDownloadProgress")

    lateinit var picker: AppContextActivityResultLauncher<PickInput, PickResult?>

    RegisterActivityContracts {
      picker = registerForActivityResult(DriveTreePickerContract())
    }

    OnCreate { registerDetachReceiver() }

    OnDestroy {
      unregisterDetachReceiver()
      downloads.values.forEach { it.abort(becauseDetached = false) }
    }

    AsyncFunction("pickDriveRoot") Coroutine { ->
      val volumes = removableVolumes()
      if (volumes.isEmpty()) {
        throw CodedException("ERR_NO_DRIVE", "No USB drive detected. Plug the drive in and try again.", null)
      }
      // Open the picker on the root of the (first) USB volume.
      val initial = DocumentsContract.buildDocumentUri(EXTERNAL_STORAGE_AUTHORITY, "${volumes.first().uuid}:")
      val picked = picker.launch(PickInput(initial.toString()))
        ?: throw CodedException("ERR_PICKER_CANCELLED", "Folder selection was cancelled", null)

      val uri = picked.uri
      val volumeId = validateUsbRoot(uri)

      // Keep access across app restarts and reboots.
      context.contentResolver.takePersistableUriPermission(uri, picked.grantFlags)

      val root = DocumentFile.fromTreeUri(context, uri)
      if (root == null || !root.canWrite()) {
        releaseGrant(uri)
        throw CodedException("ERR_NOT_WRITABLE", "The USB drive is read-only or could not be opened for writing.", null)
      }

      val volume = volumes.firstOrNull { it.uuid.equals(volumeId, ignoreCase = true) }
      watchedVolumeId = volumeId
      mapOf(
        "uri" to uri.toString(),
        "volumeId" to volumeId,
        "name" to (volume?.getDescription(context) ?: "USB drive"),
      )
    }

    // Start watching a previously granted drive (e.g. after an app restart).
    Function("watchDrive") { treeUri: String? ->
      watchedVolumeId = treeUri?.let { volumeIdOf(Uri.parse(it)) }
    }

    Function("hasAccess") { treeUri: String ->
      val uri = Uri.parse(treeUri)
      context.contentResolver.persistedUriPermissions.any {
        it.uri == uri && it.isReadPermission && it.isWritePermission
      }
    }

    AsyncFunction("isAttached") { treeUri: String ->
      isAttached(Uri.parse(treeUri))
    }

    Function("releaseAccess") { treeUri: String ->
      releaseGrant(Uri.parse(treeUri))
      watchedVolumeId = null
    }

    // Creates an empty document on the drive. The provider de-duplicates names
    // ("REC_1.mp4" -> "REC_1 (1).mp4"), so the actual name is returned.
    AsyncFunction("createFile") { treeUri: String, name: String, mimeType: String ->
      val tree = Uri.parse(treeUri)
      ensureAttached(tree)
      val doc = DocumentFile.fromTreeUri(context, tree)?.createFile(mimeType, name)
        ?: throw CodedException("ERR_CREATE_FAILED", "Could not create $name on the USB drive", null)
      mapOf("uri" to doc.uri.toString(), "name" to (doc.name ?: name))
    }

    AsyncFunction("deleteFile") { documentUri: String ->
      try {
        DocumentsContract.deleteDocument(context.contentResolver, Uri.parse(documentUri))
      } catch (_: Exception) {
        false
      }
    }

    AsyncFunction("fileSize") { documentUri: String ->
      DocumentFile.fromSingleUri(context, Uri.parse(documentUri))?.length()?.toDouble() ?: 0.0
    }

    AsyncFunction("download") Coroutine { options: DownloadOptions ->
      download(options)
    }

    Function("cancelDownload") { id: String ->
      downloads[id]?.abort(becauseDetached = false)
    }
  }

  // ---- download ------------------------------------------------------------

  private suspend fun download(o: DownloadOptions): Map<String, Any?> = withContext(Dispatchers.IO) {
    val tree = Uri.parse(o.treeUri)
    ensureAttached(tree)
    val doc = DocumentFile.fromTreeUri(context, tree)?.createFile(o.mimeType, o.name)
      ?: throw CodedException("ERR_CREATE_FAILED", "Could not create ${o.name} on the USB drive", null)

    val active = ActiveDownload()
    downloads[o.id] = active
    var written = 0L
    try {
      val conn = (URL(o.url).openConnection() as HttpURLConnection).apply {
        connectTimeout = 20_000
        readTimeout = 30_000
        instanceFollowRedirects = true
        setRequestProperty("User-Agent", "AirToDrive/1.0 (Android)")
      }
      active.connection = conn
      if (active.cancelled.get()) throw cancelledError(active, null)

      val code = conn.responseCode
      if (code !in 200..299) {
        throw CodedException("ERR_HTTP", "Server responded with HTTP $code", null)
      }
      val total = conn.contentLengthLong

      // Bytes go network -> DocumentFile output stream on the USB drive.
      // Nothing is buffered in a file on internal storage.
      val out = context.contentResolver.openOutputStream(doc.uri, "w")
        ?: throw CodedException("ERR_OPEN_FAILED", "Could not open ${o.name} on the USB drive for writing", null)
      out.use { stream ->
        conn.inputStream.use { input ->
          val buffer = ByteArray(BUFFER_SIZE)
          var lastEmit = 0L
          while (true) {
            if (active.cancelled.get()) throw cancelledError(active, null)
            val n = input.read(buffer)
            if (n < 0) break
            stream.write(buffer, 0, n)
            written += n
            val now = SystemClock.elapsedRealtime()
            if (now - lastEmit >= PROGRESS_INTERVAL_MS) {
              lastEmit = now
              emitProgress(o.id, written, total)
            }
          }
          stream.flush()
          // Push the data to the physical drive before reporting success.
          (stream as? FileOutputStream)?.fd?.sync()
        }
      }
      if (total > 0 && written != total) {
        throw CodedException("ERR_INCOMPLETE", "Connection closed early ($written of $total bytes)", null)
      }
      emitProgress(o.id, written, total)
      mapOf("uri" to doc.uri.toString(), "name" to (doc.name ?: o.name), "size" to written.toDouble())
    } catch (e: Throwable) {
      // Never leave a truncated file behind on the drive.
      try {
        doc.delete()
      } catch (_: Exception) {
      }
      throw when {
        active.cancelled.get() -> cancelledError(active, e)
        e is CodedException -> e
        else -> CodedException("ERR_DOWNLOAD_FAILED", e.message ?: "Download failed", e)
      }
    } finally {
      active.connection?.disconnect()
      downloads.remove(o.id)
    }
  }

  private fun cancelledError(active: ActiveDownload, cause: Throwable?): CodedException =
    if (active.detached.get()) {
      CodedException("ERR_DRIVE_DETACHED", "USB drive disconnected", cause)
    } else {
      CodedException("ERR_CANCELLED", "Download cancelled", cause)
    }

  private fun emitProgress(id: String, written: Long, total: Long) {
    sendEvent(
      "onDownloadProgress",
      mapOf("id" to id, "bytesWritten" to written.toDouble(), "totalBytes" to total.toDouble()),
    )
  }

  // ---- volumes / validation -------------------------------------------------

  private fun storageManager(): StorageManager =
    context.getSystemService(Context.STORAGE_SERVICE) as StorageManager

  private fun removableVolumes(): List<StorageVolume> =
    storageManager().storageVolumes.filter {
      it.isRemovable && !it.isPrimary && it.uuid != null && it.state == Environment.MEDIA_MOUNTED
    }

  private fun volumeIdOf(treeUri: Uri): String? =
    try {
      DocumentsContract.getTreeDocumentId(treeUri).substringBefore(':')
    } catch (_: Exception) {
      null
    }

  /** Returns the volume id when [uri] is the ROOT of a removable (USB) volume, otherwise throws. */
  private fun validateUsbRoot(uri: Uri): String {
    if (uri.authority != EXTERNAL_STORAGE_AUTHORITY || !DocumentsContract.isTreeUri(uri)) {
      throw CodedException("ERR_NOT_USB", "Pick the USB drive in the folder picker, not another storage provider.", null)
    }
    val docId = DocumentsContract.getTreeDocumentId(uri) // e.g. "1A2B-3C4D:" or "primary:DCIM"
    val volumeId = docId.substringBefore(':')
    val path = docId.substringAfter(':', "")
    if (volumeId.equals("primary", ignoreCase = true) || volumeId.equals("home", ignoreCase = true)) {
      throw CodedException("ERR_INTERNAL_STORAGE", "That folder is on internal phone storage. Select the USB drive instead.", null)
    }
    if (removableVolumes().none { it.uuid.equals(volumeId, ignoreCase = true) }) {
      throw CodedException("ERR_NOT_USB", "That storage is not a connected USB drive.", null)
    }
    if (path.isNotEmpty()) {
      throw CodedException("ERR_NOT_ROOT", "Open the top level of the USB drive, then tap \"Use this folder\".", null)
    }
    return volumeId
  }

  private fun isAttached(treeUri: Uri): Boolean {
    val volumeId = volumeIdOf(treeUri) ?: return false
    val mounted = storageManager().storageVolumes.any {
      it.uuid.equals(volumeId, ignoreCase = true) && it.state == Environment.MEDIA_MOUNTED
    }
    if (!mounted) return false
    return try {
      DocumentFile.fromTreeUri(context, treeUri)?.exists() == true
    } catch (_: Exception) {
      false
    }
  }

  private fun ensureAttached(treeUri: Uri) {
    if (!isAttached(treeUri)) {
      throw CodedException("ERR_DRIVE_DETACHED", "USB drive disconnected", null)
    }
  }

  private fun releaseGrant(uri: Uri) {
    try {
      context.contentResolver.releasePersistableUriPermission(
        uri,
        Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION,
      )
    } catch (_: Exception) {
    }
  }

  // ---- detach detection -----------------------------------------------------

  private fun registerDetachReceiver() {
    val ctx = appContext.reactContext ?: return
    val r = object : BroadcastReceiver() {
      override fun onReceive(c: Context, intent: Intent) = onDetachSignal(intent)
    }
    val media = IntentFilter().apply {
      addAction(Intent.ACTION_MEDIA_EJECT)
      addAction(Intent.ACTION_MEDIA_UNMOUNTED)
      addAction(Intent.ACTION_MEDIA_BAD_REMOVAL)
      addAction(Intent.ACTION_MEDIA_REMOVED)
      addDataScheme("file")
    }
    val usb = IntentFilter(UsbManager.ACTION_USB_DEVICE_DETACHED)
    // System broadcasts; EXPORTED keeps delivery reliable across OEMs/API levels.
    ContextCompat.registerReceiver(ctx, r, media, ContextCompat.RECEIVER_EXPORTED)
    ContextCompat.registerReceiver(ctx, r, usb, ContextCompat.RECEIVER_EXPORTED)
    receiver = r
  }

  private fun unregisterDetachReceiver() {
    val r = receiver ?: return
    try {
      appContext.reactContext?.unregisterReceiver(r)
    } catch (_: Exception) {
    }
    receiver = null
  }

  private fun onDetachSignal(intent: Intent) {
    val action = intent.action ?: return
    if (action == UsbManager.ACTION_USB_DEVICE_DETACHED) {
      val device = IntentCompat.getParcelableExtra(intent, UsbManager.EXTRA_DEVICE, UsbDevice::class.java)
      if (device != null && !isMassStorage(device)) return // e.g. a USB mic or hub, not the drive
    } else {
      // Media events carry the volume path (file:///storage/1A2B-3C4D).
      val volumeInEvent = intent.data?.lastPathSegment
      val watched = watchedVolumeId
      if (watched != null && volumeInEvent != null && !volumeInEvent.equals(watched, ignoreCase = true)) return
    }

    // Halt every write to the drive right now, before telling JS.
    downloads.values.forEach { it.abort(becauseDetached = true) }
    sendEvent("onDriveDetached", mapOf("action" to action, "volumeId" to watchedVolumeId))
  }

  private fun isMassStorage(device: UsbDevice): Boolean {
    if (device.deviceClass == UsbConstants.USB_CLASS_MASS_STORAGE) return true
    for (i in 0 until device.interfaceCount) {
      if (device.getInterface(i).interfaceClass == UsbConstants.USB_CLASS_MASS_STORAGE) return true
    }
    return false
  }
}
