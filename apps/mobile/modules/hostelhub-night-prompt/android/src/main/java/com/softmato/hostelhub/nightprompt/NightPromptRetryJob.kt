package com.softmato.hostelhub.nightprompt

import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.content.ComponentName
import android.content.Context
import android.os.Build
import org.json.JSONObject

/**
 * Sends answers given offline once the phone has a connection again.
 *
 * JobScheduler rather than WorkManager: one job with one network constraint is
 * all this needs, and it is part of the platform.
 */
class NightPromptRetryJob : JobService() {
  override fun onStartJob(params: JobParameters): Boolean {
    val app = applicationContext

    Thread {
      var retry = false
      var sent: JSONObject? = null
      val pending = NightPromptStore.pending(app)

      for (index in 0 until pending.length()) {
        val entry = pending.optJSONObject(index) ?: continue

        // The receiver is still posting it; look again after the backoff.
        if (entry.optString("answeredAt") in NightPromptStore.inFlight) {
          retry = true
          continue
        }

        when (NightPromptHttp.post(app, entry)) {
          PostResult.SENT -> {
            NightPromptStore.remove(app, entry.optString("answeredAt"))
            sent = entry
          }
          PostResult.DROP -> NightPromptStore.remove(app, entry.optString("answeredAt"))
          PostResult.RETRY -> retry = true
          PostResult.LEAVE_FOR_APP -> Unit
        }
      }

      /*
       * The resident answered a while ago, maybe offline, and saw only "Saved".
       * This is the line that tells them it went — left up until they look, not
       * flashed, since nobody is watching the shade when a connection comes back.
       */
      sent?.let {
        NightPromptNotifier.showState(
          app,
          it.optString("channelId").takeIf { id -> id.isNotEmpty() },
          it.optString("label").takeIf { label -> label.isNotEmpty() } ?: "Night status",
          "Sent to your hostel",
          NightPrompt.millisUntilNightEnds(it.optString("night")),
        )
      }

      jobFinished(params, retry)
    }.start()

    return true
  }

  override fun onStopJob(params: JobParameters): Boolean = true

  companion object {
    private const val JOB_ID = 0x4e5350 // "NSP"

    fun schedule(context: Context) {
      val builder = JobInfo.Builder(JOB_ID, ComponentName(context, NightPromptRetryJob::class.java))
        /*
         * On Android 9+ this means internet the OS has validated, so dead Wi-Fi
         * never starts the job. What fails once it runs is the server, and an
         * answer is only good until the night ends — so a steady 30 s step, not
         * exponential's climb toward 5 h.
         */
        .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
        .setBackoffCriteria(30_000, JobInfo.BACKOFF_POLICY_LINEAR)

      /*
       * Expedited where the platform has it: a plain job from a background app
       * can be batched for half an hour, and the receiver hands a slow reply
       * here promising "in a moment".
       */
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        builder.setExpedited(true)
      }

      val job = builder.build()

      context.getSystemService(JobScheduler::class.java)?.schedule(job)
    }
  }
}
