package lk.profitsnap.native_app.data.repository

import android.content.Context
import kotlinx.coroutines.flow.Flow
import lk.profitsnap.native_app.data.local.AppDatabase
import lk.profitsnap.native_app.data.local.entity.ProductEntity
import lk.profitsnap.native_app.data.local.entity.SyncStatus
import lk.profitsnap.native_app.sync.SyncWorker

/**
 * The pattern every other repository in this app follows: writes go to
 * Room FIRST (instant, works offline, is what the UI sees immediately via
 * the Flow below), marked PENDING, then a sync is triggered — it may run
 * now if online, or later if not; either way the write already succeeded
 * from the user's perspective. This is the entire "offline-first" contract
 * in one file.
 */
class ProductRepository(private val context: Context, private val tenantId: String) {
    private val db = AppDatabase.get(context)

    fun observeProducts(): Flow<List<ProductEntity>> = db.productDao().observeAll()

    suspend fun addProduct(
        code: String?,
        name: String,
        unit: String,
        avgCost: Double,
        sellPrice: Double,
        openingStock: Double,
    ): Long {
        val id = db.productDao().upsert(
            ProductEntity(
                tenantId = tenantId,
                code = code,
                name = name,
                unit = unit,
                avgCost = avgCost,
                sellPrice = sellPrice,
                stock = openingStock,
                created = null,
                createdAt = System.currentTimeMillis().toString(),
                syncStatus = SyncStatus.PENDING,
            )
        )
        SyncWorker.triggerImmediateSync(context)
        return id
    }

    /** Decrements stock for a sale — same clamp-at-zero behavior as the
     * web app, so an accidental over-sell never goes negative. */
    suspend fun decrementStockForSale(productLocalId: Long, qty: Double) {
        val product = db.productDao().getByLocalId(productLocalId) ?: return
        val newStock = maxOf(0.0, product.stock - qty)
        db.productDao().adjustStock(productLocalId, newStock)
        SyncWorker.triggerImmediateSync(context)
    }
}
