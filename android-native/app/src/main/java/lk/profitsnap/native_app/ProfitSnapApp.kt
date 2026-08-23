package lk.profitsnap.native_app

import android.app.Application
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import lk.profitsnap.native_app.sync.NetworkMonitor
import lk.profitsnap.native_app.sync.SyncWorker

class ProfitSnapApp : Application() {
    private val appScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    override fun onCreate() {
        super.onCreate()

        // Safety-net periodic sync (~every 15 min while the OS allows it).
        SyncWorker.schedulePeriodic(this)

        // The actual "auto sync" behavior the user asked for: the instant
        // connectivity returns, fire an immediate sync rather than waiting
        // for the next periodic tick. Repositories also trigger this right
        // after every local write, so this mainly covers the case where a
        // bunch of offline writes piled up and connectivity just came back.
        val networkMonitor = NetworkMonitor(this)
        appScope.launch {
            networkMonitor.isOnline.collectLatest { online ->
                if (online) SyncWorker.triggerImmediateSync(this@ProfitSnapApp)
            }
        }
    }
}
