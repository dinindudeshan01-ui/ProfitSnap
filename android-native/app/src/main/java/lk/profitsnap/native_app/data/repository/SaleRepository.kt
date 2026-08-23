package lk.profitsnap.native_app.data.repository

import android.content.Context
import kotlinx.coroutines.flow.Flow
import lk.profitsnap.native_app.data.local.AppDatabase
import lk.profitsnap.native_app.data.local.entity.SaleEntity
import lk.profitsnap.native_app.sync.SyncWorker
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class SaleRepository(private val context: Context, private val tenantId: String) {
    private val db = AppDatabase.get(context)
    private val products = ProductRepository(context, tenantId)

    fun observeToday(): Flow<List<SaleEntity>> = db.saleDao().observeForDate(today())

    /** Records a sale AND decrements the product's stock — both writes
     * land in Room immediately, both get marked PENDING, both go out on
     * the next sync pass. If the app crashes between the two calls (rare,
     * but possible), the sale row and the stock adjustment simply retry
     * independently next launch — Room persists both as separate pending
     * writes, so nothing is lost either way. */
    suspend fun recordSale(productLocalId: Long, qty: Double, sellPrice: Double, costAtSale: Double) {
        val product = db.productDao().getByLocalId(productLocalId)
        db.saleDao().insert(
            SaleEntity(
                tenantId = tenantId,
                productLocalId = productLocalId,
                productRemoteId = product?.remoteId,
                qty = qty,
                sellPrice = sellPrice,
                costAtSale = costAtSale,
                date = today(),
                createdAt = System.currentTimeMillis().toString(),
            )
        )
        products.decrementStockForSale(productLocalId, qty)
        SyncWorker.triggerImmediateSync(context)
    }

    private fun today(): String = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())
}
