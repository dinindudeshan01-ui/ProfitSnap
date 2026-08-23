package lk.profitsnap.native_app.data.local.entity

import androidx.room.Entity
import androidx.room.PrimaryKey

/**
 * Mirrors `products` in the Supabase schema.
 *
 * [remoteId] is null until the row has been pushed and Supabase assigns a
 * real bigint id — until then [localId] (a client-generated negative-safe
 * placeholder isn't needed since Room's autoGenerate handles local ids, and
 * we track sync state via [syncStatus] instead of relying on id shape).
 */
@Entity(tableName = "products")
data class ProductEntity(
    @PrimaryKey(autoGenerate = true) val localId: Long = 0,
    val remoteId: Long? = null,
    val tenantId: String,
    val code: String?,
    val name: String,
    val unit: String,
    val avgCost: Double,
    val sellPrice: Double,
    val stock: Double,
    val created: String?,
    val createdAt: String,
    val syncStatus: SyncStatus = SyncStatus.PENDING,
    val updatedAtLocal: Long = System.currentTimeMillis(),
    val deletedLocally: Boolean = false,
)

enum class SyncStatus { PENDING, SYNCED, CONFLICT }
