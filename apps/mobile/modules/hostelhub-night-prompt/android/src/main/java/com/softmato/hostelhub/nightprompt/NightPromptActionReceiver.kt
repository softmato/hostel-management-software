package com.softmato.hostelhub.nightprompt

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import androidx.core.app.RemoteInput
import java.util.concurrent.atomic.AtomicBoolean

/**
 * A button on the prompt. Disk, then the shade, then the network — in that
 * order, and all inside the broadcast.
 *
 * 1. The answer is committed to `NightPromptStore`, so nothing after this can
 *    lose it.
 * 2. The prompt is replaced with "Sending…" immediately. That is the moment the
 *    resident sees their tap land.
 * 3. The post runs on a thread under `goAsync()`, and the shade is updated with
 *    the outcome. The broadcast is held for `BROADCAST_BUDGET_MS` at most; a
 *    post still in flight then is handed to `NightPromptRetryJob`.
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

    // With the words and channel, so a send that happens later can still confirm it.
    NightPromptStore.add(app, answer.toJson().put("label", answer.label).putOpt("channelId", channel))
    NightPromptStore.inFlight.add(answer.answeredAt)
    NightPromptNotifier.showState(app, channel, answer.label, "Sending…", null)

    val pending = goAsync()
    val settled = AtomicBoolean(false)

    /*
     * A typed reply arrives with FLAG_RECEIVER_FOREGROUND (SystemUI's
     * RemoteInputViewController), which gives this broadcast 10 s — cold start
     * included — before the process is killed as an ANR. A slow API ran past
     * that: the post died, "Sending…" stayed up, and nothing retried until the
     * app was opened. So the broadcast ends on time whatever the network does,
     * and the retry job takes over; the thread keeps going while it can.
     */
    val watchdog = Runnable {
      if (settled.compareAndSet(false, true)) {
        NightPromptRetryJob.schedule(app)
        NightPromptNotifier.showState(app, channel, answer.label, "Saved. Sending in a moment…", 5_000)
        pending.finish()
      }
    }
    val main = Handler(Looper.getMainLooper())

    main.postDelayed(watchdog, BROADCAST_BUDGET_MS)

    Thread {
      val result = NightPromptHttp.post(app, answer.toJson())

      // Settled before the shade changes, so the watchdog cannot overwrite the outcome.
      main.removeCallbacks(watchdog)
      val holdsBroadcast = settled.compareAndSet(false, true)

      try {
        when (result) {
          PostResult.SENT -> {
            NightPromptStore.remove(app, answer.answeredAt)
            // A quick send is seen as it happens; a slow one stays until they look.
            NightPromptNotifier.showState(
              app,
              channel,
              answer.label,
              "Sent to your hostel",
              if (holdsBroadcast) 2_500 else NightPrompt.millisUntilNightEnds(answer.night),
            )
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
        // After the store is updated, so the retry job never sees it both sent and pending.
        NightPromptStore.inFlight.remove(answer.answeredAt)

        if (holdsBroadcast) {
          pending.finish()
        }
      }
    }.start()
  }

  private companion object {
    /** Well inside the 10 s a foreground broadcast gets, leaving room for a cold start. */
    const val BROADCAST_BUDGET_MS = 5_000L
  }
}
