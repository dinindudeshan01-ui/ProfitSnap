package lk.profitsnap.native_app.data.local.dao

import androidx.room.*
import kotlinx.coroutines.flow.Flow
import lk.profitsnap.native_app.data.local.entity.*

@Dao
interface SaleDao {
    @Query("SELECT * FROM sales WHERE date = :date ORDER BY createdAt DESC")
    fun observeForDate(date: String): Flow<List<SaleEntity>>

    @Query("SELECT * FROM sales WHERE syncStatus = 'PENDING'")
    suspend fun getPending(): List<SaleEntity>

    @Insert suspend fun insert(sale: SaleEntity): Long

    @Query("UPDATE sales SET remoteId = :remoteId, productRemoteId = :productRemoteId, syncStatus = 'SYNCED' WHERE localId = :localId")
    suspend fun markSynced(localId: Long, remoteId: Long, productRemoteId: Long?)
}

@Dao
interface StockInDao {
    @Query("SELECT * FROM stock_in ORDER BY createdAt DESC")
    fun observeAll(): Flow<List<StockInEntity>>

    @Query("SELECT * FROM stock_in WHERE syncStatus = 'PENDING'")
    suspend fun getPending(): List<StockInEntity>

    @Insert suspend fun insert(row: StockInEntity): Long

    @Query("UPDATE stock_in SET remoteId = :remoteId, productRemoteId = :productRemoteId, syncStatus = 'SYNCED' WHERE localId = :localId")
    suspend fun markSynced(localId: Long, remoteId: Long, productRemoteId: Long?)
}

@Dao
interface CustomerDao {
    @Query("SELECT * FROM customers ORDER BY name ASC")
    fun observeAll(): Flow<List<CustomerEntity>>

    @Query("SELECT * FROM customers WHERE localId = :localId")
    suspend fun getByLocalId(localId: Long): CustomerEntity?

    @Query("SELECT * FROM customers WHERE phone = :phone LIMIT 1")
    suspend fun findByPhone(phone: String): CustomerEntity?

    @Query("SELECT * FROM customers WHERE syncStatus = 'PENDING'")
    suspend fun getPending(): List<CustomerEntity>

    @Insert suspend fun insert(customer: CustomerEntity): Long

    @Query("UPDATE customers SET remoteId = :remoteId, syncStatus = 'SYNCED' WHERE localId = :localId")
    suspend fun markSynced(localId: Long, remoteId: Long)
}

@Dao
interface CreditSaleDao {
    @Query("SELECT * FROM credit_sales WHERE status != 'settled' ORDER BY date DESC")
    fun observeOpen(): Flow<List<CreditSaleEntity>>

    @Query("SELECT * FROM credit_sales WHERE syncStatus = 'PENDING'")
    suspend fun getPending(): List<CreditSaleEntity>

    @Insert suspend fun insert(row: CreditSaleEntity): Long

    @Query("UPDATE credit_sales SET status = 'settled', amountSettled = amount, syncStatus = 'PENDING', updatedAtLocal = :ts WHERE localId = :localId")
    suspend fun markSettledLocally(localId: Long, ts: Long = System.currentTimeMillis())

    @Query("UPDATE credit_sales SET remoteId = :remoteId, customerRemoteId = :customerRemoteId, productRemoteId = :productRemoteId, syncStatus = 'SYNCED' WHERE localId = :localId")
    suspend fun markSynced(localId: Long, remoteId: Long, customerRemoteId: Long?, productRemoteId: Long?)
}
