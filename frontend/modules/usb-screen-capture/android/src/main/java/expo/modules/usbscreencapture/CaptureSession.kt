package expo.modules.usbscreencapture

import android.annotation.SuppressLint
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioPlaybackCaptureConfiguration
import android.media.AudioRecord
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.media.MediaRecorder
import android.media.projection.MediaProjection
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.Surface
import java.io.FileDescriptor
import kotlin.math.abs

/**
 * One screen recording: MediaProjection -> VirtualDisplay -> H.264 encoder, plus
 * an AAC audio track, all muxed straight into a file descriptor on the USB drive.
 * Nothing is written to internal storage.
 *
 * Audio: tries app/playback audio first (Android 10+). Apps can opt out of being
 * captured, and Android delivers pure silence instead of an error in that case,
 * so if the first [SILENCE_WINDOW_MS] are digital silence we switch to the mic.
 */
internal class CaptureSession(
  private val projection: MediaProjection,
  fd: FileDescriptor,
  private val width: Int,
  private val height: Int,
  private val dpi: Int,
  private val wantAppAudio: Boolean,
  private val hasMicPermission: Boolean,
  private val onAudioSource: (String) -> Unit,
  private val onProjectionStopped: () -> Unit,
  private val onError: (Throwable) -> Unit,
) {
  private val audioEnabled = hasMicPermission // playback capture also needs RECORD_AUDIO
  private val sink = MuxerSink(fd, if (audioEnabled) 2 else 1)

  private var videoEncoder: MediaCodec? = null
  private var inputSurface: Surface? = null
  private var virtualDisplay: VirtualDisplay? = null
  private var videoThread: Thread? = null
  private var audioThread: Thread? = null
  private val mainHandler = Handler(Looper.getMainLooper())

  @Volatile private var stopping = false

  private val projectionCallback =
    object : MediaProjection.Callback() {
      // User tapped "Stop sharing" in the status bar / the capture chip.
      override fun onStop() {
        if (!stopping) onProjectionStopped()
      }
    }

  fun start() {
    // ---- video ----
    val format =
      MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, width, height).apply {
        setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface)
        setInteger(MediaFormat.KEY_BIT_RATE, VIDEO_BITRATE)
        setInteger(MediaFormat.KEY_FRAME_RATE, FRAME_RATE)
        setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 1)
        // Keep emitting frames when the screen is static so the file stays in sync.
        setLong(MediaFormat.KEY_REPEAT_PREVIOUS_FRAME_AFTER, 1_000_000L / FRAME_RATE)
      }
    val encoder = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_VIDEO_AVC)
    encoder.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
    inputSurface = encoder.createInputSurface()
    encoder.start()
    videoEncoder = encoder

    // Android 14+: the callback must be registered before createVirtualDisplay().
    projection.registerCallback(projectionCallback, mainHandler)
    virtualDisplay =
      projection.createVirtualDisplay(
        "AirToDriveCapture",
        width,
        height,
        dpi,
        DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
        inputSurface,
        null,
        null,
      )

    videoThread = Thread({ drainVideo(encoder) }, "usb-capture-video").also { it.start() }

    // ---- audio ----
    if (audioEnabled) {
      audioThread = Thread({ runAudio() }, "usb-capture-audio").also { it.start() }
    } else {
      onAudioSource(SOURCE_NONE)
    }
  }

  /** Stops encoding and finalises the MP4. Returns true if a playable file was written. */
  fun stop(): Boolean {
    if (stopping) return false
    stopping = true
    try {
      videoEncoder?.signalEndOfInputStream()
    } catch (e: Exception) {
      Log.w(TAG, "signalEndOfInputStream failed", e)
    }
    joinQuietly(videoThread)
    joinQuietly(audioThread)

    val ok = sink.finish()

    try {
      virtualDisplay?.release()
    } catch (_: Exception) {}
    try {
      inputSurface?.release()
    } catch (_: Exception) {}
    try {
      videoEncoder?.stop()
    } catch (_: Exception) {}
    try {
      videoEncoder?.release()
    } catch (_: Exception) {}
    try {
      projection.unregisterCallback(projectionCallback)
      projection.stop()
    } catch (_: Exception) {}
    return ok
  }

  // ---------------------------------------------------------------- video

  private fun drainVideo(encoder: MediaCodec) {
    val info = MediaCodec.BufferInfo()
    var track = -1
    var stopDeadline = 0L
    try {
      while (true) {
        val index = encoder.dequeueOutputBuffer(info, DEQUEUE_TIMEOUT_US)
        if (stopping) {
          // Some encoders never emit EOS if no frame arrived; don't hang the stop.
          if (stopDeadline == 0L) stopDeadline = System.currentTimeMillis() + EOS_WAIT_MS
          if (System.currentTimeMillis() > stopDeadline) return
        }
        when {
          index == MediaCodec.INFO_TRY_AGAIN_LATER -> continue
          index == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> track = sink.addTrack(encoder.outputFormat)
          index >= 0 -> {
            val buffer = encoder.getOutputBuffer(index)
            val isConfig = info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0
            if (buffer != null && !isConfig && track >= 0) sink.write(track, buffer, info)
            encoder.releaseOutputBuffer(index, false)
            if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) return
          }
        }
      }
    } catch (e: Exception) {
      if (!stopping) postError(e)
    }
  }

  // ---------------------------------------------------------------- audio

  @SuppressLint("MissingPermission") // RECORD_AUDIO is checked before audioEnabled is true
  private fun buildRecord(app: Boolean): AudioRecord? {
    val minBuf = AudioRecord.getMinBufferSize(SAMPLE_RATE, CHANNEL_IN, ENCODING)
    val bufSize = maxOf(minBuf * 2, READ_BYTES * 2)
    val audioFormat =
      AudioFormat.Builder()
        .setSampleRate(SAMPLE_RATE)
        .setChannelMask(CHANNEL_IN)
        .setEncoding(ENCODING)
        .build()
    return try {
      val record =
        if (app) {
          if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return null
          val config =
            AudioPlaybackCaptureConfiguration.Builder(projection)
              .addMatchingUsage(AudioAttributes.USAGE_MEDIA)
              .addMatchingUsage(AudioAttributes.USAGE_GAME)
              .addMatchingUsage(AudioAttributes.USAGE_UNKNOWN)
              .build()
          AudioRecord.Builder()
            .setAudioPlaybackCaptureConfig(config)
            .setAudioFormat(audioFormat)
            .setBufferSizeInBytes(bufSize)
            .build()
        } else {
          AudioRecord.Builder()
            .setAudioSource(MediaRecorder.AudioSource.MIC)
            .setAudioFormat(audioFormat)
            .setBufferSizeInBytes(bufSize)
            .build()
        }
      if (record.state != AudioRecord.STATE_INITIALIZED) {
        record.release()
        null
      } else {
        record.startRecording()
        record
      }
    } catch (e: Exception) {
      Log.w(TAG, "Could not open ${if (app) "app" else "mic"} audio", e)
      null
    }
  }

  private fun runAudio() {
    var usingApp = wantAppAudio
    var record = if (usingApp) buildRecord(app = true) else null
    if (record == null) {
      usingApp = false
      record = buildRecord(app = false)
    }
    if (record == null) {
      // No audio source at all — record video only.
      sink.dropExpectedTrack()
      onAudioSource(SOURCE_NONE)
      return
    }
    // App audio is only confirmed once we've heard non-silent samples.
    if (!usingApp) onAudioSource(SOURCE_MIC)

    val encoder: MediaCodec
    try {
      val format =
        MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_AAC, SAMPLE_RATE, CHANNELS).apply {
          setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC)
          setInteger(MediaFormat.KEY_BIT_RATE, AUDIO_BITRATE)
          setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, READ_BYTES * 2)
        }
      encoder = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_AUDIO_AAC)
      encoder.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
      encoder.start()
    } catch (e: Exception) {
      Log.w(TAG, "AAC encoder failed; recording video only", e)
      record.release()
      sink.dropExpectedTrack()
      onAudioSource(SOURCE_NONE)
      return
    }

    val pcm = ByteArray(READ_BYTES)
    val info = MediaCodec.BufferInfo()
    var track = -1
    var lastPtsUs = -1L
    val appStartMs = System.currentTimeMillis()
    var appDecided = !usingApp
    var peak = 0
    var sawEos = false
    var queuedEos = false

    try {
      while (!sawEos) {
        val eos = stopping
        val read = if (eos) 0 else record!!.read(pcm, 0, pcm.size)

        // While deciding, measure the loudest sample of the app-audio stream.
        if (!appDecided && read > 0) {
          peak = maxOf(peak, peakOf(pcm, read))
          if (peak > SILENCE_PEAK) {
            appDecided = true
            onAudioSource(SOURCE_APP)
          } else if (System.currentTimeMillis() - appStartMs >= SILENCE_WINDOW_MS) {
            // Pure digital silence: the app blocks playback capture (or is silent).
            // Switch to the microphone; the encoder and AAC track stay the same.
            appDecided = true
            val mic = buildRecord(app = false)
            if (mic != null) {
              record!!.stop()
              record.release()
              record = mic
              usingApp = false
              onAudioSource(SOURCE_MIC)
            } else {
              onAudioSource(SOURCE_APP) // keep app audio; mic unavailable
            }
          }
        }

        // Feed PCM (or end-of-stream) to the AAC encoder.
        if (read > 0 || (eos && !queuedEos)) {
          val inIndex = encoder.dequeueInputBuffer(DEQUEUE_TIMEOUT_US)
          if (inIndex >= 0) {
            val inBuf = encoder.getInputBuffer(inIndex)!!
            inBuf.clear()
            val n = if (eos) 0 else minOf(read, inBuf.remaining())
            if (n > 0) inBuf.put(pcm, 0, n)
            // Same clock as the VirtualDisplay frames (CLOCK_MONOTONIC), back-dated
            // by the length of this chunk so A/V stay aligned.
            var pts = System.nanoTime() / 1000 - (n / BYTES_PER_FRAME) * 1_000_000L / SAMPLE_RATE
            if (pts <= lastPtsUs) pts = lastPtsUs + 1
            lastPtsUs = pts
            encoder.queueInputBuffer(inIndex, 0, n, pts, if (eos) MediaCodec.BUFFER_FLAG_END_OF_STREAM else 0)
            if (eos) queuedEos = true
          }
        }

        // Drain whatever AAC is ready.
        while (true) {
          val outIndex = encoder.dequeueOutputBuffer(info, if (eos) DEQUEUE_TIMEOUT_US else 0)
          if (outIndex == MediaCodec.INFO_TRY_AGAIN_LATER) break
          if (outIndex == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
            track = sink.addTrack(encoder.outputFormat)
            continue
          }
          if (outIndex < 0) continue
          val outBuf = encoder.getOutputBuffer(outIndex)
          val isConfig = info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0
          if (outBuf != null && !isConfig && track >= 0) sink.write(track, outBuf, info)
          encoder.releaseOutputBuffer(outIndex, false)
          if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) {
            sawEos = true
            break
          }
        }
      }
    } catch (e: Exception) {
      if (!stopping) postError(e)
    } finally {
      try {
        record?.stop()
      } catch (_: Exception) {}
      record?.release()
      try {
        encoder.stop()
      } catch (_: Exception) {}
      encoder.release()
    }
  }

  private fun peakOf(pcm: ByteArray, len: Int): Int {
    var max = 0
    var i = 0
    while (i + 1 < len) {
      val sample = (pcm[i].toInt() and 0xFF) or (pcm[i + 1].toInt() shl 8) // 16-bit LE
      val a = abs(sample.toShort().toInt())
      if (a > max) max = a
      i += 2
    }
    return max
  }

  private fun postError(e: Throwable) {
    Log.e(TAG, "Capture failed", e)
    mainHandler.post { onError(e) }
  }

  private fun joinQuietly(t: Thread?) {
    try {
      t?.join(JOIN_TIMEOUT_MS)
    } catch (_: InterruptedException) {}
  }

  companion object {
    private const val TAG = "UsbScreenCapture"
    const val SOURCE_APP = "app"
    const val SOURCE_MIC = "microphone"
    const val SOURCE_NONE = "none"

    private const val VIDEO_BITRATE = 6_000_000
    private const val FRAME_RATE = 30
    private const val SAMPLE_RATE = 44_100
    private const val CHANNELS = 1
    private const val CHANNEL_IN = AudioFormat.CHANNEL_IN_MONO
    private const val ENCODING = AudioFormat.ENCODING_PCM_16BIT
    private const val BYTES_PER_FRAME = 2 // mono 16-bit
    private const val AUDIO_BITRATE = 128_000
    private const val READ_BYTES = 4096
    private const val DEQUEUE_TIMEOUT_US = 10_000L
    private const val JOIN_TIMEOUT_MS = 5_000L
    private const val EOS_WAIT_MS = 3_000L
    private const val SILENCE_WINDOW_MS = 4_000L
    private const val SILENCE_PEAK = 8 // of 32767 — true digital silence only
  }
}
