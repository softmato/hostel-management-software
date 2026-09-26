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
      /*
       * Answered already, but not yet sent — an offline answer, and this round
       * was queued at FCM while the phone was away. Not asked again: the push
       * arriving means the phone is online, so the answer goes now instead.
       */
      if (prompt.night != null && NightPromptStore.hasPendingFor(applicationContext, prompt.night)) {
        NightPromptRetryJob.schedule(applicationContext)
      } else {
        NightPromptNotifier.show(applicationContext, prompt)
      }
      return
    }

    super.onMessageReceived(remoteMessage)
  }
}
