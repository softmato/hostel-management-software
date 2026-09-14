package com.softmato.hostelhub.nightprompt

import android.content.Context
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * The nightly "are you in the hostel tonight?" prompt, answered entirely in
 * native code.
 *
 * ## Why this module exists
 *
 * The JavaScript path worked and was unusable. A button on a notification from
 * a closed app has to boot React Native before a line of the answer runs — on
 * the test phone that was twelve seconds of a spinning reply field — and the
 * post then went out with a fifteen-minute access token that had expired hours
 * earlier, so every answer came back 401 and waited for the app to be opened.
 *
 * Here the FCM message is drawn the moment it arrives, a tap is recorded and
 * acknowledged in the shade within the same broadcast, and the post uses the
 * answer token the prompt itself carried (`nightAnswerData` on the server). No
 * JavaScript runs at any point.
 *
 * iOS and builds without this module keep the JavaScript path in
 * `src/lib/night-status-notification.ts`, which reads the same push.
 */
internal object NightPrompt {
  /** Must equal `NIGHT_STATUS_CATEGORY` on the server and in the app. */
  const val CATEGORY = "night-status"

  /** Same tag and id as expo-notifications used, so one replaces the other. */
  const val TAG = "night-status"
  const val NOTIFICATION_ID = 0

  const val ACTION_ANSWER = "com.softmato.hostelhub.nightprompt.ANSWER"
  const val EXTRA_CHOICE = "choice"
  const val EXTRA_PROMPT = "prompt"
  const val REPLY_KEY = "night_status_note"

  const val CHOICE_INSIDE = "inside"
  const val CHOICE_HOME = "home"
  const val CHOICE_OUTSIDE = "outside"

  const val DEFAULT_ANSWER_PATH = "/api/v1/resident/night-status/answer"

  /**
   * The ready-made reasons, offered as tappable choices on the `Outside…`
   * reply. Mirrors `NIGHT_STATUS_REASONS` in `night-status-actions.ts`, minus
   * `At home`, which already has its own button.
   */
  val PRESETS: Map<String, String> = linkedMapOf(
    "At a friend's" to "FRIENDS",
    "Travelling" to "TRAVELLING",
    "Working late" to "WORKING_LATE",
    "Hospital" to "HOSPITAL",
  )

  private const val NEPAL_OFFSET_MINUTES = 5 * 60 + 45
  private const val NIGHT_STARTS_AT_HOUR = 17

  /** `nightEndsAt` from `@hostel/shared/night/night-window`, in Kotlin. */
  fun nightEndsAtMillis(night: String?): Long? {
    val parts = night?.split("-")?.mapNotNull { it.toIntOrNull() } ?: return null

    if (parts.size != 3) {
      return null
    }

    val calendar = Calendar.getInstance(TimeZone.getTimeZone("UTC")).apply {
      clear()
      set(parts[0], parts[1] - 1, parts[2] + 1, NIGHT_STARTS_AT_HOUR, 0, 0)
    }

    return calendar.timeInMillis - NEPAL_OFFSET_MINUTES * 60_000L
  }

  fun isoNow(): String =
    SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
      .apply { timeZone = TimeZone.getTimeZone("UTC") }
      .format(Date())
}

private fun JSONObject.text(key: String): String? =
  optString(key).takeIf { has(key) && !isNull(key) && it.isNotEmpty() }

/** What the push carried, as much of it as a tap needs. */
internal data class Prompt(
  val title: String,
  val body: String,
  val channelId: String?,
  val night: String?,
  val path: String?,
  val answerToken: String?,
  val answerPath: String?,
) {
  fun toJson(): String = JSONObject().apply {
    put("title", title)
    put("body", body)
    putOpt("channelId", channelId)
    putOpt("night", night)
    putOpt("path", path)
    putOpt("answerToken", answerToken)
    putOpt("answerPath", answerPath)
  }.toString()

  companion object {
    /**
     * The prompt inside a data-only FCM message from Expo, or `null`.
     *
     * Expo puts the push's `data` under the `body` key as a JSON string;
     * `push.service.ts` puts the title and body inside it as `draw`, because a
     * message with a real title would be drawn by Firebase with no buttons.
     */
    fun fromRemoteData(data: Map<String, String>): Prompt? {
      val json = try {
        JSONObject(data["body"] ?: return null)
      } catch (error: JSONException) {
        return null
      }
      val draw = json.optJSONObject("draw") ?: return null

      if (draw.text("categoryId") != NightPrompt.CATEGORY) {
        return null
      }

      return Prompt(
        title = draw.text("title") ?: return null,
        body = draw.text("body") ?: "",
        channelId = draw.text("channelId"),
        night = json.text("night"),
        path = json.text("path"),
        answerToken = json.text("answerToken"),
        answerPath = json.text("answerPath"),
      )
    }

    fun fromJson(raw: String?): Prompt? {
      val json = try {
        JSONObject(raw ?: return null)
      } catch (error: JSONException) {
        return null
      }

      return Prompt(
        title = json.text("title") ?: return null,
        body = json.text("body") ?: "",
        channelId = json.text("channelId"),
        night = json.text("night"),
        path = json.text("path"),
        answerToken = json.text("answerToken"),
        answerPath = json.text("answerPath"),
      )
    }
  }
}

/**
 * One answer, in the exact shape of `QueuedNightStatus` in the app, so the
 * JavaScript flush can take over anything this module could not send.
 */
internal data class Answer(
  val status: String,
  val reasonCode: String?,
  val note: String?,
  val answeredAt: String,
  val night: String?,
  val answerToken: String?,
  val answerPath: String?,
) {
  /** What the shade says was sent, in the words on the buttons. */
  val label: String
    get() = when {
      status == "INSIDE_HOSTEL" -> "Inside"
      reasonCode == "HOME" -> "At home"
      note != null -> "Outside · $note"
      reasonCode != null ->
        "Outside · ${NightPrompt.PRESETS.entries.firstOrNull { it.value == reasonCode }?.key ?: ""}"
      else -> "Outside"
    }

  fun toJson(): JSONObject = JSONObject().apply {
    put("status", status)
    putOpt("reasonCode", reasonCode)
    putOpt("note", note)
    put("answeredAt", answeredAt)
    putOpt("night", night)
    putOpt("answerToken", answerToken)
    putOpt("answerPath", answerPath)
  }

  companion object {
    /**
     * `parseNightStatusAction` from the app, plus the preset choices.
     *
     * A preset tapped on the reply field arrives as its own label, so it is
     * mapped back to its code with no note. Anything typed is `OTHER` with the
     * text as the note, and an empty reply is still "outside" with no reason —
     * refusing an answer for want of an explanation teaches people to stop.
     */
    fun from(choice: String?, replyText: String?, prompt: Prompt?): Answer? {
      val base = { status: String, reason: String?, note: String? ->
        Answer(
          status = status,
          reasonCode = reason,
          note = note,
          answeredAt = NightPrompt.isoNow(),
          night = prompt?.night,
          answerToken = prompt?.answerToken,
          answerPath = prompt?.answerPath,
        )
      }

      return when (choice) {
        NightPrompt.CHOICE_INSIDE -> base("INSIDE_HOSTEL", null, null)
        NightPrompt.CHOICE_HOME -> base("OUTSIDE_HOSTEL", "HOME", null)
        NightPrompt.CHOICE_OUTSIDE -> {
          val text = replyText?.trim().orEmpty()
          val preset = NightPrompt.PRESETS[text]

          when {
            preset != null -> base("OUTSIDE_HOSTEL", preset, null)
            text.isNotEmpty() -> base("OUTSIDE_HOSTEL", "OTHER", text.take(1000))
            else -> base("OUTSIDE_HOSTEL", null, null)
          }
        }
        else -> null
      }
    }
  }
}

/**
 * Answers not yet accepted by the server, on disk before any network call.
 *
 * `commit()`, not `apply()`: the process may be killed the moment the broadcast
 * returns, and an answer the resident saw acknowledged must survive that.
 */
internal object NightPromptStore {
  private const val PREFS = "hostelhub_night_prompt"
  private const val KEY_API = "apiBaseUrl"
  private const val KEY_PENDING = "pending"
  private const val MAX_PENDING = 20

  private fun prefs(context: Context) =
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  fun apiBaseUrl(context: Context): String? =
    prefs(context).getString(KEY_API, null)?.trimEnd('/')?.takeIf { it.isNotEmpty() }

  fun setApiBaseUrl(context: Context, url: String) {
    prefs(context).edit().putString(KEY_API, url).commit()
  }

  @Synchronized
  fun pending(context: Context): JSONArray = try {
    JSONArray(prefs(context).getString(KEY_PENDING, "[]"))
  } catch (error: JSONException) {
    JSONArray()
  }

  @Synchronized
  fun add(context: Context, answer: JSONObject) {
    val current = pending(context)
    val next = JSONArray()
    val start = maxOf(0, current.length() + 1 - MAX_PENDING)

    for (index in start until current.length()) {
      next.put(current.get(index))
    }

    next.put(answer)
    prefs(context).edit().putString(KEY_PENDING, next.toString()).commit()
  }

  @Synchronized
  fun remove(context: Context, answeredAt: String) {
    val current = pending(context)
    val next = JSONArray()

    for (index in 0 until current.length()) {
      val entry = current.optJSONObject(index) ?: continue

      if (entry.optString("answeredAt") != answeredAt) {
        next.put(entry)
      }
    }

    prefs(context).edit().putString(KEY_PENDING, next.toString()).commit()
  }

  /** Hands everything to the app's own queue, which then owns sending it. */
  @Synchronized
  fun takeAll(context: Context): JSONArray {
    val current = pending(context)

    prefs(context).edit().putString(KEY_PENDING, "[]").commit()

    return current
  }
}

internal enum class PostResult {
  /** The server recorded it. */
  SENT,

  /** The server refused it for good — a bad or stale token. Retrying is noise. */
  DROP,

  /** No connection, or the server was down. Worth trying when online. */
  RETRY,

  /** This module cannot send it — no token, no API address, or an older server. */
  LEAVE_FOR_APP,
}

internal object NightPromptHttp {
  private const val TIMEOUT_MS = 8_000

  fun post(context: Context, answer: JSONObject): PostResult {
    val token = answer.optString("answerToken").takeIf { it.isNotEmpty() }
      ?: return PostResult.LEAVE_FOR_APP
    val base = NightPromptStore.apiBaseUrl(context) ?: return PostResult.LEAVE_FOR_APP
    val path = answer.optString("answerPath").takeIf { it.startsWith("/") }
      ?: NightPrompt.DEFAULT_ANSWER_PATH

    val body = JSONObject().apply {
      put("status", answer.getString("status"))
      put("source", "PUSH_ACTION")
      // A retry after the resident answered again must not overwrite them.
      put("answeredAt", answer.getString("answeredAt"))
      if (answer.has("reasonCode")) put("reasonCode", answer.getString("reasonCode"))
      if (answer.has("note")) put("note", answer.getString("note"))
    }.toString().toByteArray(Charsets.UTF_8)

    return try {
      val connection = (URL("$base$path").openConnection() as HttpURLConnection).apply {
        requestMethod = "POST"
        connectTimeout = TIMEOUT_MS
        readTimeout = TIMEOUT_MS
        doOutput = true
        setRequestProperty("Authorization", "Bearer $token")
        setRequestProperty("content-type", "application/json")
        setRequestProperty("x-hostelhub-client", "mobile")
        setFixedLengthStreamingMode(body.size)
      }

      try {
        connection.outputStream.use { it.write(body) }

        when (val code = connection.responseCode) {
          in 200..299 -> PostResult.SENT
          // No such route: a server older than the answer endpoint.
          404 -> PostResult.LEAVE_FOR_APP
          400, 401, 403, 410, 422 -> PostResult.DROP
          else -> if (code == 429 || code >= 500) PostResult.RETRY else PostResult.DROP
        }
      } finally {
        connection.disconnect()
      }
    } catch (error: Exception) {
      PostResult.RETRY
    }
  }
}
