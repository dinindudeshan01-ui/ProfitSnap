package lk.profitsnap.native_app.data.local.dao

import androidx.room.*
import kotlinx.coroutines.flow.Flow
import lk.profitsnap.native_app.data.local.entity.ProductEntity
import lk.profitsnap.native_app.data.local.entity.SyncStatus

@Dao
interface ProductDao {

    // Compose screens observe this directly — Room emits a new list the
    // instant a local write happens, so the UI updates before sync ever
    // runs. This is the core of "offline-first": the local write IS the
    // update, sync is just eventual propagation to the server.
    @Query("SELECT * FROM products WHERE deletedLocally = 0 ORDER BY name ASC")
    fun observeAll(): Flow<List<ProductEntity>>

    @Query("SELECT * FROM products WHERE localId = :localId")
    suspend fun getByLocalId(localId: Long): ProductEntity?

    @Query("SELECT * FROM products WHERE remoteId = :remoteId LIMIT 1")
    suspend fun getByRemoteId(remoteId: Long): ProductEntity?

    @Query("SELECT * FROM products WHERE syncStatus = :status")
    suspend fun getByStatus(status: SyncStatus = SyncStatus.PENDING): List<ProductEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(product: ProductEntity): Long

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(products: List<ProductEntity>)

    @Update
    suspend fun update(product: ProductEntity)

    @Query("UPDATE products SET stock = :newStock, syncStatus = :status, updatedAtLocal = :ts WHERE localId = :localId")
    suspend fun adjustStock(localId: Long, newStock: Double, status: SyncStatus = SyncStatus.PENDING, ts: Long = System.currentTimeMillis())

    @Query("UPDATE products SET remoteId = :remoteId, syncStatus = :status WHERE localId = :localId")
    suspend fun markSynced(localId: Long, remoteId: Long, status: SyncStatus = SyncStatus.SYNCED)

    @Query("UPDATE products SET deletedLocally = 1, syncStatus = :status WHERE localId = :localId")
    suspend fun markDeleted(localId: Long, status: SyncStatus = SyncStatus.PENDING)
}
