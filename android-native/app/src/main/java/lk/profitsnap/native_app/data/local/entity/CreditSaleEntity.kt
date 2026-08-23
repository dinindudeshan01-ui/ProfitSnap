package lk.profitsnap.native_app.data.local.entity

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "credit_sales")
data class CreditSaleEntity(
    @PrimaryKey(autoGenerate = true) val localId: Long = 0,
    val remoteId: Long? = null,
    val tenantId: String,
    val customerLocalId: Long,
    val customerRemoteId: Long?,
    val productLocalId: Long?,
    val productRemoteId: Long?,
    val description: String?,
    val amount: Double,
    val amountSettled: Double = 0.0,
    val qty: Double?,
    val status: String = "open", // open | partially_settled | settled
    val dueDate: String?,
    val date: String,
    val syncStatus: SyncStatus = SyncStatus.PENDING,
    val updatedAtLocal: Long = System.currentTimeMillis(),
)
