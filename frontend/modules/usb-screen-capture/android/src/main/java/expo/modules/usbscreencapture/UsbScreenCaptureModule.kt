package expo.modules.usbscreencapture

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.media.MediaCodecList
import android.media.MediaFormat
import android.media.projection.MediaProjectionManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.DisplayMetrics
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

private const val REQUEST_SCREEN_CAPTURE = 0x5C47
private val FACEBOOK_PACKAGES = listOf("com.facebook.katana", "com.facebook.lite")
private const val FACEBOOK_LIVE_WEB = "https://www.facebook.com/live/producer"

private class PendingStart(val outputUri: String, val appAudio: Boolean, val promise: Promise)

class UsbScreenCaptureModule : Module() {
  private var pending: PendingStart? = null
  private var startPromise: Promise? = null

  private val context: Context
    get() = appContext.reactContext ?: throw CodedException("ERR_NO_CONTEXT", "React context unavailable", null)

  override fun definition() = ModuleDefinition {
    Name("UsbScreenCapture")

    Events("onCaptureState")

    OnCreate {
      ScreenCaptureService.listener = { state, body ->
        // Resolve / reject the start() promise once the service reports back.
        val waiting = startPromise
        if (waiting != null && (state == "started" || state == "error")) {
          startPromise = null
          if (state == "started") {
            waiting.resolve(null)
          } else {
            val message = body["message"] as? String ?: "Capture failed"
            waiting.reject(CodedException("ERR_CAPTURE_START", message, null))
          }
        }
        val bundle = Bundle()
        bundle.putString("state", state)
        for ((k, v) in body) {
          when (v) {
            is String -> bundle.putString(k, v)
            is Boolean -> bundle.putBoolean(k, v)
            null -> bundle.putString(k, null)
            else -> bundle.putString(k, v.toString())
          }
        }
        sendEvent("onCaptureState", bundle)
      }
    }

    OnDestroy {
      ScreenCaptureService.listener = null
    }

    Function("isRunning") { ScreenCaptureService.running }

    Function("getStatus") {
      mapOf(
        "running" to ScreenCaptureService.running,
        "uri" to ScreenCaptureService.currentUri,
        "audioSource" to ScreenCaptureService.audioSource,
      )
    }

    Function("isFacebookInstalled") {
      FACEBOOK_PACKAGES.any { context.packageManager.getLaunchIntentForPackage(it) != null }
    }

    // Shows Android's screen-capture consent dialog, then starts the foreground
    // service recording into `outputUri` (a content:// document on the USB drive).
    // Resolves once recording has actually started.
    AsyncFunction("start") { outputUri: String, appAudio: Boolean, promise: Promise ->
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
        promise.reject(CodedException("ERR_UNSUPPORTED", "Screen recording to USB needs Android 8.0 or newer", null))
        return@AsyncFunction
      }
      if (ScreenCaptureService.running || pending != null || startPromise != null) {
        promise.reject(CodedException("ERR_BUSY", "A screen recording is already running", null))
        return@AsyncFunction
      }
      val activity = appContext.currentActivity
      if (activity == null) {
        promise.reject(CodedException("ERR_NO_ACTIVITY", "App is not in the foreground", null))
        return@AsyncFunction
      }
      val mpm = activity.getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
      pending = PendingStart(outputUri, appAudio, promise)
      try {
        activity.startActivityForResult(mpm.createScreenCaptureIntent(), REQUEST_SCREEN_CAPTURE)
      } catch (e: Exception) {
        pending = null
        promise.reject(CodedException("ERR_CAPTURE_INTENT", e.message ?: "Could not request screen capture", e))
      }
    }

    AsyncFunction("stop") {
      if (!ScreenCaptureService.running) return@AsyncFunction false
      val intent = Intent(context, ScreenCaptureService::class.java).setAction(ScreenCaptureService.ACTION_STOP)
      context.startService(intent)
      true
    }

    // Opens the Facebook app (or Lite); falls back to Live Producer in the browser.
    AsyncFunction("openFacebook") {
      val activity = appContext.currentActivity
      val launcher: Context = activity ?: context
      val pm = launcher.packageManager
      for (pkg in FACEBOOK_PACKAGES) {
        val launch = pm.getLaunchIntentForPackage(pkg) ?: continue
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        launcher.startActivity(launch)
        return@AsyncFunction "app"
      }
      val web = Intent(Intent.ACTION_VIEW, Uri.parse(FACEBOOK_LIVE_WEB)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      launcher.startActivity(web)
      "web"
    }

    OnActivityResult { activity, payload ->
      if (payload.requestCode != REQUEST_SCREEN_CAPTURE) return@OnActivityResult
      val req = pending ?: return@OnActivityResult
      pending = null
      if (payload.resultCode != Activity.RESULT_OK || payload.data == null) {
        req.promise.reject(CodedException("ERR_CAPTURE_DENIED", "Screen recording permission was declined", null))
        return@OnActivityResult
      }
      val (w, h, dpi) = captureSize(activity)
      val intent =
        Intent(activity, ScreenCaptureService::class.java)
          .setAction(ScreenCaptureService.ACTION_START)
          .putExtra(ScreenCaptureService.EXTRA_RESULT_CODE, payload.resultCode)
          .putExtra(ScreenCaptureService.EXTRA_RESULT_DATA, payload.data)
          .putExtra(ScreenCaptureService.EXTRA_OUTPUT_URI, req.outputUri)
          .putExtra(ScreenCaptureService.EXTRA_APP_AUDIO, req.appAudio)
          .putExtra(ScreenCaptureService.EXTRA_WIDTH, w)
          .putExtra(ScreenCaptureService.EXTRA_HEIGHT, h)
          .putExtra(ScreenCaptureService.EXTRA_DPI, dpi)
      startPromise = req.promise
      try {
        activity.startForegroundService(intent)
      } catch (e: Exception) {
        startPromise = null
        req.promise.reject(CodedException("ERR_SERVICE", e.message ?: "Could not start capture service", e))
      }
    }
  }

  /** Screen size scaled so the device's H.264 encoder accepts it (long side <= 1920). */
  private fun captureSize(activity: Activity): Triple<Int, Int, Int> {
    var w: Int
    var h: Int
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      val bounds = activity.windowManager.currentWindowMetrics.bounds
      w = bounds.width()
      h = bounds.height()
    } else {
      val dm = DisplayMetrics()
      @Suppress("DEPRECATION")
      activity.windowManager.defaultDisplay.getRealMetrics(dm)
      w = dm.widthPixels
      h = dm.heightPixels
    }
    val dpi = activity.resources.displayMetrics.densityDpi

    var scale = minOf(1.0, MAX_LONG_SIDE / maxOf(w, h).toDouble())
    var outW = align(w * scale)
    var outH = align(h * scale)
    while (!encoderSupports(outW, outH) && maxOf(outW, outH) > 640) {
      scale *= 0.8
      outW = align(w * scale)
      outH = align(h * scale)
    }
    return Triple(outW, outH, dpi)
  }

  private fun align(v: Double): Int = maxOf(16, (v.toInt() / 16) * 16)

  private fun encoderSupports(w: Int, h: Int): Boolean =
    try {
      MediaCodecList(MediaCodecList.REGULAR_CODECS).codecInfos.any { info ->
        info.isEncoder &&
          info.supportedTypes.any { it.equals(MediaFormat.MIMETYPE_VIDEO_AVC, ignoreCase = true) } &&
          info.getCapabilitiesForType(MediaFormat.MIMETYPE_VIDEO_AVC).videoCapabilities?.isSizeSupported(w, h) == true
      }
    } catch (_: Exception) {
      true
    }

  companion object {
    private const val MAX_LONG_SIDE = 1920.0
  }
}
