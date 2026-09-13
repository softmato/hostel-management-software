package com.softmato.hostelhub.sound

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.Ringtone
import android.media.RingtoneManager
import android.net.Uri
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Plays the app's notification tone the way a notification would, for one
 * that reached the open app over the socket rather than as a push.
 *
 * expo-audio can play the same file, but only as media — and on Android the
 * media stream carries on with the phone switched to silent or vibrate. For a
 * chime that arrives unprompted that is the sound that gets an app muted for
 * good. A `Ringtone` with notification attributes goes through the notification
 * stream instead: its volume, the ringer mode, and Do Not Disturb, which mutes
 * that stream.
 */
class HostelPalikaSoundModule : Module() {
  /** The tone still playing, so a second arrival restarts rather than overlaps. */
  private var current: Ringtone? = null

  override fun definition() = ModuleDefinition {
    Name("HostelHubSound")

    /**
     * Resolves whether a tone was started. `false` — silent or vibrate, no
     * context, a tone the system would not build — is an answer rather than an
     * error: the phone chose silence, and the caller must not work around it.
     *
     * On the main queue because `Ringtone` wraps a `MediaPlayer`, which wants a
     * looper thread to deliver its completion to.
     */
    AsyncFunction("playNotificationTone") {
      playNotificationTone()
    }.runOnQueue(Queues.MAIN)
  }

  private fun playNotificationTone(): Boolean {
    val context = appContext.reactContext ?: return false
    val audio = context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager ?: return false

    // Vibrate and silent both mean "no sounds"; a real notification would not
    // make one either.
    if (audio.ringerMode != AudioManager.RINGER_MODE_NORMAL) {
      return false
    }

    val ringtone = RingtoneManager.getRingtone(context, toneUri(context)) ?: return false

    ringtone.audioAttributes = AudioAttributes.Builder()
      .setUsage(AudioAttributes.USAGE_NOTIFICATION)
      .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
      .build()

    current?.stop()
    current = ringtone
    ringtone.play()

    return true
  }

  /**
   * The bundled water drop — the same raw resource the `default_v2` and
   * `food_v2` channels play — or the phone's own tone if a build lacks it.
   */
  private fun toneUri(context: Context): Uri {
    val id = context.resources.getIdentifier("water_drop", "raw", context.packageName)

    return if (id != 0) {
      Uri.parse("android.resource://${context.packageName}/$id")
    } else {
      RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
    }
  }
}
