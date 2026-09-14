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
     * Every answer this module could not send, as a JSON array of
     * `QueuedNightStatus`, removed from native storage in the same call. The
     * app's queue then owns them.
     */
    Function("takePendingAnswers") {
      appContext.reactContext?.applicationContext
        ?.let { NightPromptStore.takeAll(it).toString() }
        ?: "[]"
    }
  }
}
