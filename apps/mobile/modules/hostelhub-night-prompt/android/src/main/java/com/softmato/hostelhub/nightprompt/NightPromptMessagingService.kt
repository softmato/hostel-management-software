package com.softmato.hostelhub.nightprompt

import com.google.firebase.messaging.RemoteMessage
import expo.modules.notifications.service.ExpoFirebaseMessagingService

/**
 * Takes the night-status prompt off the FCM stream before expo-notifications
 * sees it, and hands every other message to expo-notifications unchanged.
 *
 * Extending expo's service rather than sitting beside it matters: Android
 * delivers each FCM message to exactly one service, so a separate one would
 * have to reimplement token refresh and every other notification. As a
 * subclass, `super` is the entire existing behaviour.
 */
class NightPromptMessagingService : ExpoFirebaseMessagingService() {
  override fun onMessageReceived(remoteMessage: RemoteMessage) {
    // Only a data-only message can be ours; see `Prompt.fromRemoteData`.
    val prompt = if (remoteMessage.notification == null) {
      Prompt.fromRemoteData(remoteMessage.data)
    } else {
      null
    }

    if (prompt != null) {
      NightPromptNotifier.show(applicationContext, prompt)
      return
    }

    super.onMessageReceived(remoteMessage)
  }
}
