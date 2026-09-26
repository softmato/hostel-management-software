package com.softmato.hostelhub.nightprompt

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * The two things JavaScript has to tell or ask the native prompt handler.
 */
class HostelHubNightPromptModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("HostelHubNightPrompt")

    /**
     * Where answers post. Set on every push registration, which always precedes
     * the first prompt, because the address is a build-time value that only the
     * JavaScript bundle knows.
     */
    Function("configure") { apiBaseUrl: String ->
      appContext.reactContext?.applicationContext?.let {
        NightPromptStore.setApiBaseUrl(it, apiBaseUrl)
      }
    }

    /**
     * Every answer this module has not sent yet, as a JSON array of
     * `QueuedNightStatus`, left in place. The app sends what it can and removes
     * those; the rest stay here for the retry job, which — unlike an app that
     * was opened offline and closed again — runs the moment the phone is back
     * online.
     */
    Function("pendingAnswers") {
      appContext.reactContext?.applicationContext
        ?.let { NightPromptStore.pending(it).toString() }
        ?: "[]"
    }

    Function("removePendingAnswer") { answeredAt: String ->
      appContext.reactContext?.applicationContext?.let {
        NightPromptStore.remove(it, answeredAt)
      }
    }
  }
}
