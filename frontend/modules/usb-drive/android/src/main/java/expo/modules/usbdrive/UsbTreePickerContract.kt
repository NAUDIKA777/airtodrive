package expo.modules.usbdrive

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.storage.StorageManager
import android.provider.DocumentsContract
import expo.modules.kotlin.activityresult.AppContextActivityResultContract
import java.io.Serializable

data class UsbPickInput(val preferredUuid: String?) : Serializable

sealed class UsbPickResult {
  data class Picked(val uri: String, val returnedFlags: Int) : UsbPickResult()
  object Cancelled : UsbPickResult()
}

/**
 * ACTION_OPEN_DOCUMENT_TREE, pointed at the USB volume, requesting persistable
 * READ + WRITE access.
 */
class UsbTreePickerContract : AppContextActivityResultContract<UsbPickInput, UsbPickResult> {
  override fun createIntent(context: Context, input: UsbPickInput): Intent {
    val sm = context.getSystemService(Context.STORAGE_SERVICE) as? StorageManager
    val volume = input.preferredUuid?.let { uuid -> sm?.storageVolumes?.firstOrNull { it.uuid == uuid } }

    val intent =
      if (volume != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        // Android 10+: the volume builds a tree intent that opens right at its root.
        volume.createOpenDocumentTreeIntent()
      } else {
        Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
          if (input.preferredUuid != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            putExtra(DocumentsContract.EXTRA_INITIAL_URI, UsbDriveModule.volumeRootDocument(input.preferredUuid))
          }
        }
      }

    return intent.apply {
      addFlags(
        Intent.FLAG_GRANT_READ_URI_PERMISSION or
          Intent.FLAG_GRANT_WRITE_URI_PERMISSION or
          Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION or
          Intent.FLAG_GRANT_PREFIX_URI_PERMISSION,
      )
      // Hidden-but-honoured extras that make older / OEM pickers list SD + USB
      // volumes instead of hiding them behind the overflow menu.
      putExtra("android.content.extra.SHOW_ADVANCED", true)
      putExtra("android.provider.extra.SHOW_ADVANCED", true)
      putExtra("android.content.extra.FANCY", true)
      putExtra("android.content.extra.SHOW_FILESIZE", true)
    }
  }

  override fun parseResult(input: UsbPickInput, resultCode: Int, intent: Intent?): UsbPickResult {
    val uri = intent?.data
    if (resultCode != Activity.RESULT_OK || uri == null) return UsbPickResult.Cancelled
    return UsbPickResult.Picked(uri.toString(), intent.flags)
  }
}
