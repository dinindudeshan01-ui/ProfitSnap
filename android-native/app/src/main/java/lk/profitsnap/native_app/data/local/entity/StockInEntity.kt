package lk.profitsnap.native_app.data.local.entity

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "stock_in")
data class StockInEntity(
    @PrimaryKey(autoGenerate = true) val localId: Long = 0,
    val remoteId: Long? = null,
    val tenantId: String,
    val productLocalId: Long,
    val productRemoteId: Long?,
    val qty: Double,
    val cost: Double,
    val date: String,
    val createdAt: String,
    val syncStatus: SyncStatus = SyncStatus.PENDING,
    val updatedAtLocal: Long = System.currentTimeMillis(),
)
