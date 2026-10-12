package expo.modules.usbscreencapture

import android.media.MediaCodec
import android.media.MediaFormat
import android.media.MediaMuxer
import android.util.Log
import java.io.FileDescriptor
import java.nio.ByteBuffer

/**
 * Thread-safe wrapper around MediaMuxer writing straight into a file descriptor
 * (a document on the USB drive). The video and audio encoder threads both write
 * here; the muxer starts once every expected track has reported its format, and
 * samples that arrive earlier are held briefly so the first keyframe isn't lost.
 */
internal class MuxerSink(fd: FileDescriptor, private var expectedTracks: Int) {
  private val muxer = MediaMuxer(fd, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
  private var addedTracks = 0
  private var started = false
  private var released = false
  private var wroteSamples = false

  private class Pending(val track: Int, val data: ByteArray, val info: MediaCodec.BufferInfo)
  private val pending = ArrayList<Pending>()

  @Synchronized
  fun addTrack(format: MediaFormat): Int {
    val index = muxer.addTrack(format)
    addedTracks++
    maybeStart()
    return index
  }

  /** The audio pipeline could not start at all — run video-only. */
  @Synchronized
  fun dropExpectedTrack() {
    if (expectedTracks > 1) expectedTracks--
    maybeStart()
  }

  @Synchronized
  fun write(track: Int, buffer: ByteBuffer, info: MediaCodec.BufferInfo) {
    if (released || info.size <= 0) return
    if (!started) {
      if (pending.size >= MAX_PENDING) pending.removeAt(0)
      val copy = ByteArray(info.size)
      buffer.position(info.offset)
      buffer.get(copy, 0, info.size)
      val infoCopy = MediaCodec.BufferInfo().apply { set(0, info.size, info.presentationTimeUs, info.flags) }
      pending.add(Pending(track, copy, infoCopy))
      return
    }
    buffer.position(info.offset)
    buffer.limit(info.offset + info.size)
    muxer.writeSampleData(track, buffer, info)
    wroteSamples = true
  }

  private fun maybeStart() {
    if (started || addedTracks < expectedTracks) return
    muxer.start()
    started = true
    for (p in pending) {
      muxer.writeSampleData(p.track, ByteBuffer.wrap(p.data), p.info)
      wroteSamples = true
    }
    pending.clear()
  }

  /** Finalises the MP4 (writes the moov atom). Returns true if a playable file was written. */
  @Synchronized
  fun finish(): Boolean {
    if (released) return false
    released = true
    var ok = false
    try {
      if (started && wroteSamples) {
        muxer.stop()
        ok = true
      }
    } catch (e: Exception) {
      Log.w(TAG, "Muxer stop failed", e)
    }
    try {
      muxer.release()
    } catch (e: Exception) {
      Log.w(TAG, "Muxer release failed", e)
    }
    return ok
  }

  companion object {
    private const val TAG = "UsbScreenCapture"
    private const val MAX_PENDING = 240
  }
}
