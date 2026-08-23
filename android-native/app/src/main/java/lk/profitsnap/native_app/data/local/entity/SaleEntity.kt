package lk.profitsnap.native_app.data.local.entity

import androidx.room.Entity
import androidx.room.PrimaryKey

/** Mirrors `sales`. [productRemoteId] is the FK used once synced; while
 * offline we keep [productLocalId] to resolve it after the product itself
 * has synced and received a real remote id (see SyncEngine ordering). */
@Entity(tableName = "sales")
data class SaleEntity(
    @PrimaryKey(autoGenerate = true) val localId: Long = 0,
    val remoteId: Long? = null,
    val tenantId: String,
    val productLocalId: Long,
    val productRemoteId: Long?,
    val qty: Double,
    val sellPrice: Double,
    val costAtSale: Double,
    val date: String,
    val createdAt: String,
    val syncStatus: SyncStatus = SyncStatus.PENDING,
    val updatedAtLocal: Long = System.currentTimeMillis(),
)
