package com.airtodrive.usbdrive

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.DocumentsContract
import expo.modules.kotlin.activityresult.AppContextActivityResultContract
import java.io.Serializable

internal data class PickInput(val initialUri: String?) : Serializable

internal data class PickResult(val uri: Uri, val grantFlags: Int)

/**
 * Opens the Storage Access Framework folder picker (ACTION_OPEN_DOCUMENT_TREE),
 * pre-navigated to the USB drive's root, so the user taps "Use this folder".
 * Persisting the grant happens in the module, after the pick is validated.
 */
internal class DriveTreePickerContract : AppContextActivityResultContract<PickInput, PickResult?> {
  override fun createIntent(context: Context, input: PickInput): Intent =
    Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
      addFlags(
        Intent.FLAG_GRANT_READ_URI_PERMISSION or
          Intent.FLAG_GRANT_WRITE_URI_PERMISSION or
          Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION or
          Intent.FLAG_GRANT_PREFIX_URI_PERMISSION,
      )
      input.initialUri?.let { putExtra(DocumentsContract.EXTRA_INITIAL_URI, Uri.parse(it)) }
    }

  override fun parseResult(input: PickInput, resultCode: Int, intent: Intent?): PickResult? {
    if (resultCode != Activity.RESULT_OK || intent == null) return null
    val uri = intent.data ?: return null
    val flags = intent.flags and (Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
    return PickResult(uri, flags)
  }
}
