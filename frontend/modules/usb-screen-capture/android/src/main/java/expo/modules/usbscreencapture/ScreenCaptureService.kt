package expo.modules.usbscreencapture

import android.Manifest
import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.media.projection.MediaProjectionManager
import android.net.Uri
import android.os.Build
import android.os.IBinder
import android.os.ParcelFileDescriptor
import android.util.Log

/**
 * Foreground service required by Android for MediaProjection. Holds the active
 * [CaptureSession] and the USB file descriptor, shows an ongoing notification
 * with a Stop action, and reports state back to JS through [listener].
 */
class ScreenCaptureService : Service() {
  private var session: CaptureSession? = null
  private var pfd: ParcelFileDescriptor? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_START -> handleStart(intent)
      ACTION_STOP -> finishCapture(null)
      else -> stopSelf()
    }
    return START_NOT_STICKY
  }

  private fun handleStart(intent: Intent) {
    if (session != null) return
    val outputUri = intent.getStringExtra(EXTRA_OUTPUT_URI)
    val resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, Activity.RESULT_CANCELED)
    @Suppress("DEPRECATION")
    val resultData: Intent? =
      if (Build.VERSION.SDK_INT >= 33) {
        intent.getParcelableExtra(EXTRA_RESULT_DATA, Intent::class.java)
      } else {
        intent.getParcelableExtra(EXTRA_RESULT_DATA)
      }
    val width = intent.getIntExtra(EXTRA_WIDTH, 0)
    val height = intent.getIntExtra(EXTRA_HEIGHT, 0)
    val dpi = intent.getIntExtra(EXTRA_DPI, 320)
    val wantAppAudio = intent.getBooleanExtra(EXTRA_APP_AUDIO, true)

    val hasMic =
      checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED

    // Must be foreground (with the mediaProjection type) BEFORE getMediaProjection().
    try {
      goForeground(hasMic)
    } catch (e: Exception) {
      fail(outputUri, "Could not start the capture service: ${e.message}")
      return
    }

    if (outputUri == null || resultData == null || width <= 0 || height <= 0) {
      fail(outputUri, "Missing capture parameters")
      return
    }

    try {
      val mpm = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
      val projection =
        mpm.getMediaProjection(resultCode, resultData)
          ?: throw IllegalStateException("Screen capture permission was not granted")
      // "rw" so MediaMuxer can seek back and write the moov atom on the USB file.
      val fd =
        contentResolver.openFileDescriptor(Uri.parse(outputUri), "rw")
          ?: throw IllegalStateException("Could not open the USB file for writing")
      pfd = fd

      val s =
        CaptureSession(
          projection = projection,
          fd = fd.fileDescriptor,
          width = width,
          height = height,
          dpi = dpi,
          wantAppAudio = wantAppAudio,
          hasMicPermission = hasMic,
          onAudioSource = { source ->
            audioSource = source
            emit("audio", mapOf("uri" to outputUri, "audioSource" to source))
          },
          onProjectionStopped = { finishCapture(null) },
          onError = { e -> finishCapture(e.message ?: "Capture failed") },
        )
      session = s
      currentUri = outputUri
      running = true
      audioSource = if (hasMic) "pending" else CaptureSession.SOURCE_NONE
      s.start()
      emit("started", mapOf("uri" to outputUri, "audioSource" to audioSource))
    } catch (e: Exception) {
      Log.e(TAG, "Failed to start capture", e)
      session = null
      closeFd()
      fail(outputUri, e.message ?: "Could not start screen capture")
    }
  }

  private fun goForeground(hasMic: Boolean) {
    val notification = buildNotification()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      var type = ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
      if (hasMic && Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        type = type or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
      }
      startForeground(NOTIFICATION_ID, notification, type)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
  }

  /** Stop encoding, finalise the MP4 on the drive, close the fd, tear down. */
  private fun finishCapture(errorMessage: String?) {
    val s = session
    val uri = currentUri
    session = null
    if (s == null) {
      stopEverything()
      return
    }
    // Finalising can block (joins encoder threads) — keep it off the main thread.
    Thread({
      val ok =
        try {
          s.stop()
        } catch (e: Exception) {
          Log.w(TAG, "Stop failed", e)
          false
        }
      closeFd()
      running = false
      currentUri = null
      if (errorMessage != null && !ok) {
        emit("error", mapOf("uri" to uri, "message" to errorMessage, "playable" to false))
      } else {
        emit(
          "finished",
          mapOf("uri" to uri, "playable" to ok, "audioSource" to audioSource, "message" to errorMessage),
        )
      }
      stopEverything()
    }, "usb-capture-stop").start()
  }

  private fun fail(uri: String?, message: String) {
    running = false
    currentUri = null
    emit("error", mapOf("uri" to uri, "message" to message, "playable" to false))
    stopEverything()
  }

  private fun stopEverything() {
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
        stopForeground(STOP_FOREGROUND_REMOVE)
      } else {
        @Suppress("DEPRECATION")
        stopForeground(true)
      }
    } catch (_: Exception) {}
    stopSelf()
  }

  private fun closeFd() {
    try {
      pfd?.close()
    } catch (e: Exception) {
      Log.w(TAG, "Failed to close USB file", e)
    }
    pfd = null
  }

  override fun onDestroy() {
    // System killed us mid-capture: still try to finalise what we have.
    session?.let {
      session = null
      val ok =
        try {
          it.stop()
        } catch (_: Exception) {
          false
        }
      closeFd()
      running = false
      emit("finished", mapOf("uri" to currentUri, "playable" to ok, "audioSource" to audioSource))
      currentUri = null
    }
    super.onDestroy()
  }

  private fun buildNotification(): Notification {
    val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      nm.createNotificationChannel(
        NotificationChannel(CHANNEL_ID, "Screen recording to USB", NotificationManager.IMPORTANCE_LOW),
      )
    }
    val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    val stopIntent =
      PendingIntent.getService(
        this,
        1,
        Intent(this, ScreenCaptureService::class.java).setAction(ACTION_STOP),
        flags,
      )
    val openIntent =
      packageManager.getLaunchIntentForPackage(packageName)?.let {
        PendingIntent.getActivity(this, 2, it, flags)
      }
    val builder =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        Notification.Builder(this, CHANNEL_ID)
      } else {
        @Suppress("DEPRECATION")
        Notification.Builder(this)
      }
    @Suppress("DEPRECATION")
    return builder
      .setSmallIcon(android.R.drawable.presence_video_online)
      .setContentTitle("Recording screen to USB")
      .setContentText("Facebook Live capture is being saved to your drive")
      .setOngoing(true)
      .setContentIntent(openIntent)
      .addAction(Notification.Action.Builder(null, "Stop", stopIntent).build())
      .build()
  }

  private fun emit(state: String, body: Map<String, Any?>) {
    listener?.invoke(state, body)
  }

  companion object {
    private const val TAG = "UsbScreenCapture"
    private const val CHANNEL_ID = "usb_screen_capture"
    private const val NOTIFICATION_ID = 0x5C4E

    const val ACTION_START = "expo.modules.usbscreencapture.START"
    const val ACTION_STOP = "expo.modules.usbscreencapture.STOP"
    const val EXTRA_RESULT_CODE = "resultCode"
    const val EXTRA_RESULT_DATA = "resultData"
    const val EXTRA_OUTPUT_URI = "outputUri"
    const val EXTRA_APP_AUDIO = "appAudio"
    const val EXTRA_WIDTH = "width"
    const val EXTRA_HEIGHT = "height"
    const val EXTRA_DPI = "dpi"

    /** (state, body) -> forwarded to JS as `onCaptureState`. */
    @Volatile var listener: ((String, Map<String, Any?>) -> Unit)? = null
    @Volatile var running = false
    @Volatile var currentUri: String? = null
    @Volatile var audioSource: String = CaptureSession.SOURCE_NONE
  }
}
