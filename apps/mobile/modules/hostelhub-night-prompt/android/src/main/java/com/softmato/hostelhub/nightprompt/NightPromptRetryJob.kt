package com.softmato.hostelhub.nightprompt

import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.content.ComponentName
import android.content.Context

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
      val pending = NightPromptStore.pending(app)

      for (index in 0 until pending.length()) {
        val entry = pending.optJSONObject(index) ?: continue

        when (NightPromptHttp.post(app, entry)) {
          PostResult.SENT, PostResult.DROP ->
            NightPromptStore.remove(app, entry.optString("answeredAt"))
          PostResult.RETRY -> retry = true
          PostResult.LEAVE_FOR_APP -> Unit
        }
      }

      jobFinished(params, retry)
    }.start()

    return true
  }

  override fun onStopJob(params: JobParameters): Boolean = true

  companion object {
    private const val JOB_ID = 0x4e5350 // "NSP"

    fun schedule(context: Context) {
      val job = JobInfo.Builder(JOB_ID, ComponentName(context, NightPromptRetryJob::class.java))
        .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
        .setBackoffCriteria(30_000, JobInfo.BACKOFF_POLICY_EXPONENTIAL)
        .build()

      context.getSystemService(JobScheduler::class.java)?.schedule(job)
    }
  }
}
