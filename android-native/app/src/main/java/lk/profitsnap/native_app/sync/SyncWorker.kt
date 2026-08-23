package lk.profitsnap.native_app.sync

import android.content.Context
import androidx.work.*
import kotlinx.coroutines.flow.first
import lk.profitsnap.native_app.data.local.AppDatabase
import lk.profitsnap.native_app.data.remote.SessionStore
import lk.profitsnap.native_app.data.remote.SupabaseClient
import lk.profitsnap.native_app.data.remote.PostgrestApi
import java.util.concurrent.TimeUnit

class SyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        return try {
            val sessionStore = SessionStore(applicationContext)
            val tenantId = sessionStore.userIdFlow.first() ?: return Result.success() // not signed in — nothing to sync
            val db = AppDatabase.get(applicationContext)
            val postgrest = SupabaseClient.postgrest(sessionStore).create(PostgrestApi::class.java)
            SyncEngine(db, postgrest, tenantId).runFullSync()
            Result.success()
        } catch (e: Exception) {
            // Network hiccup, token expiry, etc. — retry with WorkManager's
            // backoff rather than dropping the pending rows; they stay
            // marked PENDING in Room either way, so nothing is lost.
            Result.retry()
        }
    }

    companion object {
        private const val UNIQUE_PERIODIC = "profitsnap_periodic_sync"
        private const val UNIQUE_ONE_TIME = "profitsnap_immediate_sync"

        /** Call once at app start (e.g. from Application.onCreate). Runs
         * roughly every 15 minutes when the OS allows, as a safety net on
         * top of the reconnect-triggered sync below. */
        fun schedulePeriodic(context: Context) {
            val constraints = Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build()
            val request = PeriodicWorkRequestBuilder<SyncWorker>(15, TimeUnit.MINUTES)
                .setConstraints(constraints)
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, WorkRequest.MIN_BACKOFF_MILLIS, TimeUnit.MILLISECONDS)
                .build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                UNIQUE_PERIODIC, ExistingPeriodicWorkPolicy.KEEP, request,
            )
        }

        /** Call whenever [NetworkMonitor] reports the device just came back
         * online, or right after any local write, so a sale recorded while
         * offline goes out the moment connectivity returns instead of
         * waiting up to 15 minutes for the periodic tick. */
        fun triggerImmediateSync(context: Context) {
            val constraints = Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build()
            val request = OneTimeWorkRequestBuilder<SyncWorker>()
                .setConstraints(constraints)
                .build()
            WorkManager.getInstance(context).enqueueUniqueWork(
                UNIQUE_ONE_TIME, ExistingWorkPolicy.KEEP, request,
            )
        }
    }
}
