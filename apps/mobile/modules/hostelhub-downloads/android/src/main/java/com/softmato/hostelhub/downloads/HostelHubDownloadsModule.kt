package com.softmato.hostelhub.downloads

import android.content.ActivityNotFoundException
import android.content.ContentValues
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

/**
 * Saves a file the app has already downloaded into the phone's Downloads folder,
 * with no permission and no dialogue.
 *
 * See `../../../../../../../README.md` for why none of the permission-based
 * routes work on a modern Android and why this one needs nothing.
 */
class HostelHubDownloadsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("HostelHubDownloads")

    /**
     * Whether this device can do it at all.
     *
     * Read once by the JS side rather than inferred from `Platform.Version`, so
     * the capability is answered by the code that implements it.
     */
    Property("isSupported") {
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
    }

    /**
     * Copies `sourceUri` into `Download/<subfolder>/<fileName>`.
     *
     * Returns both the public path — so the caller can say where the file went
     * rather than "saved somewhere" — and the `content://` URI, which is the
     * only handle that can later be opened. A path is not openable on a scoped
     * -storage Android; every other app has to be handed the content URI with a
     * read grant attached, which is what `openDownload` does.
     */
    AsyncFunction("saveToDownloads") { sourceUri: String, fileName: String, mimeType: String, subfolder: String ->
      saveToDownloads(sourceUri, fileName, mimeType, subfolder)
    }

    /**
     * Opens a saved download in whatever app handles its type.
     *
     * Exists because a notification saying "downloaded" that does nothing when
     * tapped is worse than no notification — it is the one gesture every person
     * with a phone already expects to work.
     */
    AsyncFunction("openDownload") { uri: String, mimeType: String ->
      openDownload(uri, mimeType)
    }
  }

  private fun openDownload(uri: String, mimeType: String) {
    val context = appContext.reactContext ?: throw NoContextException()

    val intent = Intent(Intent.ACTION_VIEW).apply {
      setDataAndType(Uri.parse(uri), mimeType)
      /*
       * The read grant travels with the intent. Our app owns this MediaStore
       * row; the spreadsheet app the user picks does not, and without the flag
       * it opens to a permission error rather than to the file.
       */
      addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      // Started from a notification tap, so there is no activity to attach to.
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }

    try {
      context.startActivity(intent)
    } catch (error: ActivityNotFoundException) {
      throw NothingOpensThisException(mimeType)
    }
  }

  private fun saveToDownloads(
    sourceUri: String,
    fileName: String,
    mimeType: String,
    subfolder: String
  ): Map<String, String> {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
      /*
       * The Downloads collection and RELATIVE_PATH both arrive in API 29. Below
       * that the only public write needs WRITE_EXTERNAL_STORAGE and a runtime
       * dialogue, which is the thing this module exists to avoid — so it says so
       * and the JS falls back to the Storage Access Framework grant.
       */
      throw UnsupportedOnThisAndroidException()
    }

    val context = appContext.reactContext ?: throw NoContextException()
    val resolver = context.contentResolver
    val source = File(Uri.parse(sourceUri).path ?: throw UnreadableSourceException(sourceUri))

    if (!source.exists()) {
      throw UnreadableSourceException(sourceUri)
    }

    val relativePath = "${Environment.DIRECTORY_DOWNLOADS}/$subfolder"

    val pending = ContentValues().apply {
      put(MediaStore.Downloads.DISPLAY_NAME, fileName)
      put(MediaStore.Downloads.MIME_TYPE, mimeType)
      put(MediaStore.Downloads.RELATIVE_PATH, relativePath)
      /*
       * Marks the row as half-written so nothing — a file manager, a gallery
       * scan, another app's picker — can open it mid-copy. Cleared below once
       * the bytes are all through. A crash between the two leaves a pending row
       * that Android reaps on its own after a week.
       */
      put(MediaStore.Downloads.IS_PENDING, 1)
    }

    val collection = MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
    val target = resolver.insert(collection, pending) ?: throw CouldNotCreateFileException(fileName)

    try {
      resolver.openOutputStream(target)?.use { output ->
        source.inputStream().use { input -> input.copyTo(output) }
      } ?: throw CouldNotCreateFileException(fileName)
    } catch (error: Throwable) {
      // A half-written row is worse than no row: it shows up in Downloads as a
      // file that opens to nothing.
      runCatching { resolver.delete(target, null, null) }
      throw error
    }

    resolver.update(
      target,
      ContentValues().apply { put(MediaStore.Downloads.IS_PENDING, 0) },
      null,
      null
    )

    /*
     * MediaStore renames on collision — a second export becomes
     * `hostel-statement (1).csv` — so the name it actually used is read back
     * rather than assumed. That is also the browser's behaviour, which is the
     * one people already expect from a download.
     */
    val saved = resolver.query(target, arrayOf(MediaStore.Downloads.DISPLAY_NAME), null, null, null)
      ?.use { cursor -> if (cursor.moveToFirst()) cursor.getString(0) else null }
      ?: fileName

    return mapOf(
      "path" to "$relativePath/$saved",
      "uri" to target.toString()
    )
  }
}

private class UnsupportedOnThisAndroidException :
  CodedException("Saving to Downloads without a permission needs Android 10 or newer.")

private class NoContextException :
  CodedException("The Android context was not available.")

private class UnreadableSourceException(uri: String) :
  CodedException("The downloaded file could not be read at $uri.")

private class CouldNotCreateFileException(name: String) :
  CodedException("Downloads would not accept a file named $name.")

private class NothingOpensThisException(mimeType: String) :
  CodedException("This phone has no app that opens $mimeType files.")
