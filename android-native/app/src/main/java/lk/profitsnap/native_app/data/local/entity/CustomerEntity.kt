package lk.profitsnap.native_app.data.local.entity

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "customers")
data class CustomerEntity(
    @PrimaryKey(autoGenerate = true) val localId: Long = 0,
    val remoteId: Long? = null,
    val tenantId: String,
    val name: String,
    val phone: String?,
    val syncStatus: SyncStatus = SyncStatus.PENDING,
    val updatedAtLocal: Long = System.currentTimeMillis(),
)
