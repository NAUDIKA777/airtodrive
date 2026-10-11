package expo.modules.usbdrive

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.Uri
import android.os.Environment
import android.os.storage.StorageManager
import android.os.storage.StorageVolume
import android.provider.DocumentsContract
import android.util.Log
import androidx.core.content.ContextCompat
import expo.modules.kotlin.activityresult.AppContextActivityResultLauncher
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

private const val TAG = "UsbDrive"
private const val EXTERNAL_STORAGE_AUTHORITY = "com.android.externalstorage.documents"
private const val RW = Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION

class PickerCancelledException : CodedException("ERR_CANCELLED", "Folder picker was cancelled", null)
class NotWritableException : CodedException(
  "ERR_NOT_WRITABLE",
  "Android did not grant persistent write access to that folder. Pick a folder on the USB drive and tap \"Use this folder\" → \"Allow\".",
  null,
)

/**
 * Air to Drive — USB drive access through the Storage Access Framework.
 *
 * Why this exists instead of expo-file-system's Directory.pickDirectoryAsync():
 *  - That picker never adds FLAG_GRANT_PERSISTABLE_URI_PERMISSION / WRITE to the
 *    request, and only persists whatever flags the picker happens to echo back.
 *    Several OEM pickers (Samsung, Xiaomi, older Pixels) echo none, so the grant
 *    silently dies on app restart, replug or reboot.
 *  - It opens wherever the picker was last used (usually internal storage), so
 *    people pick the wrong volume.
 *
 * This module opens ACTION_OPEN_DOCUMENT_TREE directly on the USB volume, always
 * requests + persists READ and WRITE, verifies the grant actually stuck, and can
 * re-check access at any time (drive unplugged, permission revoked, etc.).
 */
class UsbDriveModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private var volumeReceiver: BroadcastReceiver? = null

  override fun definition() = ModuleDefinition {
    Name("UsbDrive")

    // Fired when any removable volume is mounted / unmounted / yanked.
    Events("onVolumeChange")

    lateinit var pickLauncher: AppContextActivityResultLauncher<UsbPickInput, UsbPickResult>
    RegisterActivityContracts {
      pickLauncher = registerForActivityResult(UsbTreePickerContract())
    }

    // Removable volumes currently mounted (USB OTG drives, SD cards).
    Function("listRemovableVolumes") {
      removableVolumes().map { v ->
        mapOf("uuid" to v.uuid, "label" to v.getDescription(context))
      }
    }

    // Open the system folder picker on the USB drive and persist R/W access.
    AsyncFunction("pickFolderAsync") Coroutine { ->
      val result = pickLauncher.launch(UsbPickInput(preferredUuid = removableVolumes().firstOrNull()?.uuid))
      val picked = result as? UsbPickResult.Picked ?: throw PickerCancelledException()
      val uri = Uri.parse(picked.uri)
      persist(uri, picked.returnedFlags)
      val info = describe(uri)
      if (info["canWrite"] != true) throw NotWritableException()
      info
    }

    // Re-validate a stored drive URI: persisted grant + drive actually present.
    Function("checkAccess") { uriString: String ->
      describe(Uri.parse(uriString))
    }

    // Drop the persisted grant when the user ejects the drive in the app.
    Function("releaseAccess") { uriString: String ->
      try {
        context.contentResolver.releasePersistableUriPermission(Uri.parse(uriString), RW)
      } catch (e: Exception) {
        Log.w(TAG, "releasePersistableUriPermission failed for $uriString", e)
      }
    }

    OnCreate { registerVolumeReceiver() }
    OnDestroy { unregisterVolumeReceiver() }
  }

  // ---- permissions -------------------------------------------------------

  private fun persist(uri: Uri, returnedFlags: Int) {
    val resolver = context.contentResolver
    // 1st choice: always ask for READ + WRITE (we requested both in the intent).
    try {
      resolver.takePersistableUriPermission(uri, RW)
      return
    } catch (e: SecurityException) {
      Log.w(TAG, "Persisting READ|WRITE failed, retrying with returned flags", e)
    }
    // Fallback: persist whatever subset the picker really granted.
    val subset = returnedFlags and RW
    if (subset != 0) {
      try {
        resolver.takePersistableUriPermission(uri, subset)
      } catch (e: SecurityException) {
        Log.w(TAG, "Persisting returned flags ($subset) failed", e)
      }
    }
  }

  private fun describe(treeUri: Uri): Map<String, Any?> {
    val grant = context.contentResolver.persistedUriPermissions.firstOrNull { it.uri == treeUri }
    val canRead = grant?.isReadPermission == true
    val canWrite = grant?.isWritePermission == true
    val docId = try {
      DocumentsContract.getTreeDocumentId(treeUri)
    } catch (e: Exception) {
      null
    }
    val volumeId = docId?.substringBefore(':')
    val volume = removableVolumes().firstOrNull { it.uuid != null && it.uuid.equals(volumeId, ignoreCase = true) }
    val isInternal = treeUri.authority == EXTERNAL_STORAGE_AUTHORITY && volumeId.equals("primary", ignoreCase = true)
    val present = canRead && isReachable(treeUri, docId)

    val status = when {
      grant == null -> "no_permission"
      !present -> "unmounted"
      !canWrite -> "read_only"
      else -> "ok"
    }
    return mapOf(
      "uri" to treeUri.toString(),
      "status" to status,
      "canRead" to canRead,
      "canWrite" to canWrite,
      "isInternal" to isInternal,
      "isRemovable" to (volume != null),
      "label" to (volume?.getDescription(context) ?: if (isInternal) "Internal storage" else "USB drive"),
      "folder" to docId?.substringAfter(':', "")?.ifEmpty { null },
    )
  }

  private fun isReachable(treeUri: Uri, docId: String?): Boolean {
    if (docId == null) return false
    return try {
      val docUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, docId)
      context.contentResolver
        .query(docUri, arrayOf(DocumentsContract.Document.COLUMN_DOCUMENT_ID), null, null, null)
        ?.use { it.moveToFirst() } ?: false
    } catch (e: Exception) {
      // FileNotFoundException / IllegalArgumentException when the drive is gone.
      false
    }
  }

  // ---- volumes -----------------------------------------------------------

  private fun removableVolumes(): List<StorageVolume> {
    val sm = context.getSystemService(Context.STORAGE_SERVICE) as? StorageManager ?: return emptyList()
    return sm.storageVolumes.filter { v ->
      !v.isPrimary && v.isRemovable && v.state == Environment.MEDIA_MOUNTED
    }
  }

  private fun registerVolumeReceiver() {
    if (volumeReceiver != null) return
    val receiver = object : BroadcastReceiver() {
      override fun onReceive(ctx: Context, intent: Intent) {
        sendEvent("onVolumeChange", mapOf("action" to intent.action))
      }
    }
    val filter = IntentFilter().apply {
      addAction(Intent.ACTION_MEDIA_MOUNTED)
      addAction(Intent.ACTION_MEDIA_UNMOUNTED)
      addAction(Intent.ACTION_MEDIA_EJECT)
      addAction(Intent.ACTION_MEDIA_REMOVED)
      addAction(Intent.ACTION_MEDIA_BAD_REMOVAL)
      addDataScheme("file")
    }
    try {
      ContextCompat.registerReceiver(context, receiver, filter, ContextCompat.RECEIVER_EXPORTED)
      volumeReceiver = receiver
    } catch (e: Exception) {
      Log.w(TAG, "Could not register volume receiver", e)
    }
  }

  private fun unregisterVolumeReceiver() {
    val receiver = volumeReceiver ?: return
    volumeReceiver = null
    try {
      context.unregisterReceiver(receiver)
    } catch (e: Exception) {
      // already gone
    }
  }

  companion object {
    /** Document URI for the root of a volume, used as the picker's starting point. */
    fun volumeRootDocument(uuid: String): Uri =
      DocumentsContract.buildDocumentUri(EXTERNAL_STORAGE_AUTHORITY, "$uuid:")
  }
}
