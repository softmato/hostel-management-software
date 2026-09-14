package com.softmato.hostelhub.nightprompt

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.RemoteInput

/**
 * A button on the prompt. Disk, then the shade, then the network — in that
 * order, and all inside the broadcast.
 *
 * 1. The answer is committed to `NightPromptStore`, so nothing after this can
 *    lose it.
 * 2. The prompt is replaced with "Sending…" immediately. That is the moment the
 *    resident sees their tap land.
 * 3. The post runs on a thread under `goAsync()`, which gives it the seconds it
 *    needs without the process being reclaimed, and the shade is updated with
 *    the outcome.
 */
class NightPromptActionReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != NightPrompt.ACTION_ANSWER) {
      return
    }

    val app = context.applicationContext
    val prompt = Prompt.fromJson(intent.getStringExtra(NightPrompt.EXTRA_PROMPT))
    val reply = RemoteInput.getResultsFromIntent(intent)
      ?.getCharSequence(NightPrompt.REPLY_KEY)
      ?.toString()
    val answer = Answer.from(intent.getStringExtra(NightPrompt.EXTRA_CHOICE), reply, prompt)
      ?: return
    val channel = prompt?.channelId

    NightPromptStore.add(app, answer.toJson())
    NightPromptNotifier.showState(app, channel, answer.label, "Sending…", null)

    val pending = goAsync()

    Thread {
      try {
        when (NightPromptHttp.post(app, answer.toJson())) {
          PostResult.SENT -> {
            NightPromptStore.remove(app, answer.answeredAt)
            NightPromptNotifier.showState(app, channel, answer.label, "Sent to your hostel", 2_500)
          }
          PostResult.DROP -> {
            NightPromptStore.remove(app, answer.answeredAt)
            NightPromptNotifier.showState(
              app,
              channel,
              "Not sent",
              "This question has closed. Open the app to update tonight's status.",
              8_000,
            )
          }
          PostResult.RETRY -> {
            NightPromptRetryJob.schedule(app)
            NightPromptNotifier.showState(
              app,
              channel,
              answer.label,
              "Saved. It will send when you are back online.",
              5_000,
            )
          }
          PostResult.LEAVE_FOR_APP -> NightPromptNotifier.showState(
            app,
            channel,
            answer.label,
            "Saved. It will send when you next open the app.",
            5_000,
          )
        }
      } finally {
        pending.finish()
      }
    }.start()
  }
}
