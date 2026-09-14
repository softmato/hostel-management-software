package com.softmato.hostelhub.nightprompt

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.RemoteInput

/**
 * Draws the prompt, and then what became of the answer, in the same slot.
 *
 * Replacing the prompt the instant a button is pressed is what makes it feel
 * like a reply in a chat app: Android keeps a spinner under a typed reply until
 * the notification changes, and before this it changed only after a network
 * round trip — or never.
 */
internal object NightPromptNotifier {
  /** Used only if the app's own channel does not exist yet; see `channel`. */
  private const val FALLBACK_CHANNEL = "night_status_fallback"

  fun show(context: Context, prompt: Prompt) {
    val channelId = channel(context, prompt.channelId)
    val promptJson = prompt.toJson()

    val reply = RemoteInput.Builder(NightPrompt.REPLY_KEY)
      .setLabel("Where are you tonight?")
      .setChoices(NightPrompt.PRESETS.keys.toTypedArray())
      .setAllowFreeFormInput(true)
      .build()

    val builder = NotificationCompat.Builder(context, channelId)
      .setSmallIcon(smallIcon(context))
      .setContentTitle(prompt.title)
      .setContentText(prompt.body)
      .setStyle(NotificationCompat.BigTextStyle().bigText(prompt.body))
      .setCategory(NotificationCompat.CATEGORY_REMINDER)
      .setAutoCancel(true)
      .setContentIntent(openApp(context, prompt.path))
      .addAction(
        NotificationCompat.Action.Builder(0, "Inside", answer(context, NightPrompt.CHOICE_INSIDE, promptJson, false))
          .setShowsUserInterface(false)
          .build(),
      )
      .addAction(
        NotificationCompat.Action.Builder(0, "At home", answer(context, NightPrompt.CHOICE_HOME, promptJson, false))
          .setShowsUserInterface(false)
          .build(),
      )
      .addAction(
        NotificationCompat.Action.Builder(0, "Outside…", answer(context, NightPrompt.CHOICE_OUTSIDE, promptJson, true))
          .addRemoteInput(reply)
          .setAllowGeneratedReplies(false)
          .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_REPLY)
          .setShowsUserInterface(false)
          .build(),
      )

    color(context)?.let { builder.setColor(it) }

    /* An unanswered question disappears when its night does. */
    NightPrompt.nightEndsAtMillis(prompt.night)
      ?.let { it - System.currentTimeMillis() }
      ?.takeIf { it > 0 }
      ?.let { builder.setTimeoutAfter(it) }

    /*
     * Cleared first, then posted. The server asks again every round until the
     * resident answers, and an update to a notification still in the shade is
     * silent — so without the cancel, round two would change nothing anybody
     * could hear. One notification in the shade either way.
     */
    NotificationManagerCompat.from(context).cancel(NightPrompt.TAG, NightPrompt.NOTIFICATION_ID)
    notify(context, builder)
  }

  /**
   * Replaces the prompt with a line about the answer, silently.
   *
   * `timeoutMs` clears it on its own once there is nothing left to say; `null`
   * leaves it up while the post is still in flight.
   */
  fun showState(context: Context, channelHint: String?, title: String, text: String, timeoutMs: Long?) {
    val builder = NotificationCompat.Builder(context, channel(context, channelHint))
      .setSmallIcon(smallIcon(context))
      .setContentTitle(title)
      .setContentText(text)
      .setSilent(true)
      .setOnlyAlertOnce(true)
      .setAutoCancel(true)
      .setCategory(NotificationCompat.CATEGORY_STATUS)

    color(context)?.let { builder.setColor(it) }
    timeoutMs?.let { builder.setTimeoutAfter(it) }

    notify(context, builder)
  }

  private fun notify(context: Context, builder: NotificationCompat.Builder) {
    try {
      NotificationManagerCompat.from(context)
        .notify(NightPrompt.TAG, NightPrompt.NOTIFICATION_ID, builder.build())
    } catch (error: SecurityException) {
      // Notifications turned off. The prompt is also in the bell.
    }
  }

  private fun answer(context: Context, choice: String, promptJson: String, mutable: Boolean): PendingIntent {
    val intent = Intent(context, NightPromptActionReceiver::class.java)
      .setAction(NightPrompt.ACTION_ANSWER)
      .putExtra(NightPrompt.EXTRA_CHOICE, choice)
      .putExtra(NightPrompt.EXTRA_PROMPT, promptJson)

    /*
     * A reply action's intent must be mutable — the OS writes the typed text
     * into it. Before Android 12 that means *no* immutability flag at all:
     * FLAG_IMMUTABLE there silently drops the text, which is exactly what the
     * first build did on an Android 10 phone. The button intents have nothing
     * to receive and stay immutable.
     */
    val flags = PendingIntent.FLAG_UPDATE_CURRENT or when {
      !mutable -> PendingIntent.FLAG_IMMUTABLE
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.S -> PendingIntent.FLAG_MUTABLE
      else -> 0
    }

    return PendingIntent.getBroadcast(context, choice.hashCode(), intent, flags)
  }

  /** A tap on the body opens the night-status screen, as the push used to. */
  private fun openApp(context: Context, path: String?): PendingIntent? {
    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return null
    val route = (path ?: "/night-status").trimStart('/')

    launch.action = Intent.ACTION_VIEW
    launch.data = Uri.parse("hostelpalika://$route")
    launch.flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP

    return PendingIntent.getActivity(
      context,
      "open".hashCode(),
      launch,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }

  /**
   * The channel the server named, which the app creates on every launch with
   * the app's own tone. A channel's sound is frozen when it is created, so this
   * never creates *that* id itself — a phone that somehow lacks it gets a
   * separate fallback rather than a `default_v2` with the wrong sound forever.
   */
  private fun channel(context: Context, requested: String?): String {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      return requested ?: FALLBACK_CHANNEL
    }

    val manager = context.getSystemService(NotificationManager::class.java)

    if (requested != null && manager.getNotificationChannel(requested) != null) {
      return requested
    }

    if (manager.getNotificationChannel(FALLBACK_CHANNEL) == null) {
      manager.createNotificationChannel(
        NotificationChannel(FALLBACK_CHANNEL, "Night status", NotificationManager.IMPORTANCE_DEFAULT),
      )
    }

    return FALLBACK_CHANNEL
  }

  /** The same icon and colour expo-notifications reads from the manifest. */
  private fun smallIcon(context: Context): Int {
    val id = context.resources.getIdentifier("notification_icon", "drawable", context.packageName)

    return if (id != 0) id else context.applicationInfo.icon
  }

  private fun color(context: Context): Int? {
    val id = context.resources.getIdentifier("notification_icon_color", "color", context.packageName)

    return if (id != 0) context.getColor(id) else null
  }
}
