package com.softmato.hostelhub.downloads

import android.content.ActivityNotFoundException
import android.content.ContentResolver
import android.content.ContentUris
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
 * Saves a file the app has already downloaded into a folder the phone shows the
 * user, with no permission and no dialogue.
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
     * Copies `sourceUri` into the right public folder for its type.
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
     * Opens a saved file in whatever app handles its type.
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

  /**
   * The collection and public folder a file of this type belongs in.
   *
   * ## Why an image does not go in Downloads
   *
   * It did, and tapping "Saved" on a saved ID card did nothing. `MediaStore` is
   * not one bucket with a MIME column: a row in the **Downloads** collection is
   * a download, and a gallery does not show downloads or reliably answer an
   * `ACTION_VIEW` for one — Samsung's does not. A row in the **Images**
   * collection is a picture, so it appears in the gallery beside the camera roll
   * and the intent resolves to something that opens it. A PDF hit none of that,
   * which is why documents worked and pictures did not.
   *
   * The subfolder name is the same either way, so everything the app saves is
   * still under one name the user recognises — `Pictures/HostelHub/` for the
   * card and the QR, `Download/HostelHub/` for statements and receipts, which is
   * where a person looks for each of them anyway.
   *
   * Only images are split out. Video and audio have their own collections too,
   * but this app saves neither today and a branch for a case that does not exist
   * is a branch nobody has ever run.
   */
  private fun destinationFor(mimeType: String, subfolder: String): Pair<Uri, String> =
    if (mimeType.startsWith("image/")) {
      MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY) to
        "${Environment.DIRECTORY_PICTURES}/$subfolder"
    } else {
      MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY) to
        "${Environment.DIRECTORY_DOWNLOADS}/$subfolder"
    }

  /** A row ready to be written to, and whether it is one we just made. */
  private class Claim(val uri: Uri, val created: Boolean)

  /**
   * Gets a writable, half-written row for this file, or `null`.
   *
   * ## Why this is not one `insert`
   *
   * `files._data` is UNIQUE. **Android 11 renames around that for you** — a
   * second `hostel-statement.pdf` silently becomes `hostel-statement (1).pdf`,
   * the way a browser download does — and this module was written believing that
   * was MediaStore's behaviour rather than that release's. It is not. On Android
   * 10, where the Downloads collection was introduced, the provider does no such
   * thing: the insert reaches SQLite as-is and comes back
   *
   *     SQLiteConstraintException: UNIQUE constraint failed: files._data
   *
   * so the *first* save of a given name succeeded and every save of that name
   * afterwards failed, for ever, on every screen with a download button.
   *
   * ## The three attempts, in this order
   *
   * 1. **Reuse our own row.** A repeat export is the same file regenerated, so
   *    it is rewritten in place rather than sat beside — the same rule
   *    `lib/documents.ts` applies to the cache copy, and the reason a resident
   *    who taps Statement four times ends up with one file and not four. Writing
   *    through the existing row also sidesteps the constraint entirely, which
   *    deleting the row first does not: on Android 10 a deleted row can leave
   *    its file behind, and the orphaned path collides just the same.
   * 2. **Insert.** Nothing is there — the common case, and the first save of
   *    anything.
   * 3. **Number it.** Only reachable when something we cannot write holds the
   *    path — another app's file, or an orphan left by an uninstall. We go
   *    around it and the save still lands.
   *
   * Every attempt catches: a collision surfaces differently across vendors and
   * API levels — a `null`, a `SQLiteConstraintException`, or whatever Binder
   * turns that into on the way across — and all of them mean the same thing.
   */
  private fun claimRow(
    resolver: ContentResolver,
    collection: Uri,
    relativePath: String,
    fileName: String,
    mimeType: String
  ): Claim? {
    findRow(resolver, collection, relativePath, fileName)?.let { existing ->
      if (markPending(resolver, existing)) {
        return Claim(existing, created = false)
      }
    }

    insertPending(resolver, collection, relativePath, fileName, mimeType)?.let {
      return Claim(it, created = true)
    }

    // Bounded rather than `while (true)`: if a hundred names in a row are taken,
    // something is wrong that another attempt will not fix, and the JS ladder
    // has two more rungs waiting.
    for (attempt in 1..MAX_NUMBERED_ATTEMPTS) {
      insertPending(resolver, collection, relativePath, numbered(fileName, attempt), mimeType)
        ?.let { return Claim(it, created = true) }
    }

    return null
  }

  /**
   * The existing row for this exact folder and name, if there is one.
   *
   * `RELATIVE_PATH` is stored with a trailing slash — `Pictures/HostelHub/` — so
   * the match has to carry one too or it silently selects nothing, which is the
   * shape of bug that looks like the query working.
   */
  private fun findRow(
    resolver: ContentResolver,
    collection: Uri,
    relativePath: String,
    fileName: String
  ): Uri? = try {
    resolver.query(
      collection,
      arrayOf(MediaStore.MediaColumns._ID),
      "${MediaStore.MediaColumns.RELATIVE_PATH}=? AND ${MediaStore.MediaColumns.DISPLAY_NAME}=?",
      arrayOf("$relativePath/", fileName),
      null
    )?.use { cursor ->
      if (cursor.moveToFirst()) ContentUris.withAppendedId(collection, cursor.getLong(0)) else null
    }
  } catch (error: Throwable) {
    null
  }

  /**
   * Marks an existing row half-written, and says whether that was allowed.
   *
   * `false` means the row is not ours — MediaStore refuses the update rather
   * than letting one app edit another's file — and the caller goes and makes its
   * own row instead of failing.
   */
  private fun markPending(resolver: ContentResolver, uri: Uri): Boolean = try {
    resolver.update(
      uri,
      ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 1) },
      null,
      null
    ) > 0
  } catch (error: Throwable) {
    false
  }

  /** One insert attempt. `null` means the name is taken, however that was said. */
  private fun insertPending(
    resolver: ContentResolver,
    collection: Uri,
    relativePath: String,
    fileName: String,
    mimeType: String
  ): Uri? = try {
    resolver.insert(
      collection,
      ContentValues().apply {
        put(MediaStore.MediaColumns.DISPLAY_NAME, fileName)
        put(MediaStore.MediaColumns.MIME_TYPE, mimeType)
        put(MediaStore.MediaColumns.RELATIVE_PATH, relativePath)
        /*
         * Marks the row as half-written so nothing — a file manager, a gallery
         * scan, another app's picker — can open it mid-copy. Cleared by the
         * caller once the bytes are all through.
         */
        put(MediaStore.MediaColumns.IS_PENDING, 1)
      }
    )
  } catch (error: Throwable) {
    null
  }

  /** `statement.pdf` at 2 becomes `statement (2).pdf` — the browser's spelling. */
  private fun numbered(fileName: String, attempt: Int): String {
    val dot = fileName.lastIndexOf('.')

    return if (dot > 0) {
      "${fileName.substring(0, dot)} ($attempt)${fileName.substring(dot)}"
    } else {
      "$fileName ($attempt)"
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
       * The public collections and RELATIVE_PATH both arrive in API 29. Below
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

    val (collection, relativePath) = destinationFor(mimeType, subfolder)
    val claim = claimRow(resolver, collection, relativePath, fileName, mimeType)
      ?: throw CouldNotCreateFileException(fileName)

    try {
      /*
       * `"wt"` — write, truncate. A reused row already has the previous copy's
       * bytes in it, and a plain write leaves the tail of a longer file behind
       * the end of a shorter one, which is how a valid PDF becomes a corrupt
       * one that still opens far enough to look fine.
       */
      resolver.openOutputStream(claim.uri, "wt")?.use { output ->
        source.inputStream().use { input -> input.copyTo(output) }
      } ?: throw CouldNotCreateFileException(fileName)
    } catch (error: Throwable) {
      /*
       * A half-written row is worse than no row: it shows up as a file that
       * opens to nothing. Only a row we made is deleted — clearing the pending
       * flag is the most that may be done to one that was already the user's,
       * since deleting it would take a file they had before this call.
       */
      if (claim.created) {
        runCatching { resolver.delete(claim.uri, null, null) }
      } else {
        runCatching { clearPending(resolver, claim.uri) }
      }

      throw error
    }

    clearPending(resolver, claim.uri)

    /*
     * The name is read back rather than assumed, because `claimRow` may have had
     * to number it — and on an Android that does its own de-duplication, the
     * provider may have numbered it without telling us.
     */
    val saved = resolver.query(
      claim.uri,
      arrayOf(MediaStore.MediaColumns.DISPLAY_NAME),
      null,
      null,
      null
    )?.use { cursor -> if (cursor.moveToFirst()) cursor.getString(0) else null } ?: fileName

    return mapOf(
      "path" to "$relativePath/$saved",
      "uri" to claim.uri.toString()
    )
  }

  /** Publishes the row — until this runs, nothing else on the phone can see it. */
  private fun clearPending(resolver: ContentResolver, uri: Uri) {
    resolver.update(
      uri,
      ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) },
      null,
      null
    )
  }
}

private const val MAX_NUMBERED_ATTEMPTS = 100

private class UnsupportedOnThisAndroidException :
  CodedException("Saving a file without a permission needs Android 10 or newer.")

private class NoContextException :
  CodedException("The Android context was not available.")

private class UnreadableSourceException(uri: String) :
  CodedException("The downloaded file could not be read at $uri.")

private class CouldNotCreateFileException(name: String) :
  CodedException("The phone would not accept a file named $name.")

private class NothingOpensThisException(mimeType: String) :
  CodedException("This phone has no app that opens $mimeType files.")
