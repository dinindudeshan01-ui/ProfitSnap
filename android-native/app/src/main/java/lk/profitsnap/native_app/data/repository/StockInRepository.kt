package lk.profitsnap.native_app.data.repository

import android.content.Context
import kotlinx.coroutines.flow.Flow
import lk.profitsnap.native_app.data.local.AppDatabase
import lk.profitsnap.native_app.data.local.entity.StockInEntity
import lk.profitsnap.native_app.sync.SyncWorker
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class StockInRepository(private val context: Context, private val tenantId: String) {
    private val db = AppDatabase.get(context)

    fun observeAll(): Flow<List<StockInEntity>> = db.stockInDao().observeAll()

    /** Records a purchase AND increments the product's stock — mirrors
     * SaleRepository.recordSale() exactly, just adding instead of
     * subtracting. Same offline-first contract: both writes land in Room
     * immediately, both sync independently and safely retry on failure. */
    suspend fun recordStockIn(productLocalId: Long, qty: Double, cost: Double) {
        val product = db.productDao().getByLocalId(productLocalId)
        db.stockInDao().insert(
            StockInEntity(
                tenantId = tenantId,
                productLocalId = productLocalId,
                productRemoteId = product?.remoteId,
                qty = qty,
                cost = cost,
                date = today(),
                createdAt = System.currentTimeMillis().toString(),
            )
        )
        if (product != null) {
            val newStock = product.stock + qty
            // Stock-in also nudges avg_cost via a simple weighted average,
            // matching the "QuickBooks-style" cost tracking the web app
            // already does on the Items screen — good enough for a shop
            // owner's real usage; a full moving-average costing engine
            // (zeroCostLots-style, like the Rowan Accounting ERP) is
            // deliberately out of scope for the native app's v1.
            val newAvgCost = if (product.stock + qty > 0)
                ((product.avgCost * product.stock) + (cost * qty)) / (product.stock + qty)
            else cost
            db.productDao().update(
                product.copy(stock = newStock, avgCost = newAvgCost, syncStatus = lk.profitsnap.native_app.data.local.entity.SyncStatus.PENDING)
            )
        }
        SyncWorker.triggerImmediateSync(context)
    }

    private fun today(): String = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())
}
