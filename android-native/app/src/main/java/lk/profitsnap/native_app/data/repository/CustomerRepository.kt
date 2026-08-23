package lk.profitsnap.native_app.data.repository

import android.content.Context
import kotlinx.coroutines.flow.Flow
import lk.profitsnap.native_app.data.local.AppDatabase
import lk.profitsnap.native_app.data.local.entity.CustomerEntity
import lk.profitsnap.native_app.sync.SyncWorker

class CustomerRepository(private val context: Context, private val tenantId: String) {
    private val db = AppDatabase.get(context)

    fun observeAll(): Flow<List<CustomerEntity>> = db.customerDao().observeAll()

    /** Same dedup-by-phone logic as the web app's ItemPicker/manual credit
     * sale flow — reuses an existing customer row rather than forking a
     * new one for the same person. */
    suspend fun findOrCreate(name: String, phone: String?): CustomerEntity {
        if (!phone.isNullOrBlank()) {
            db.customerDao().findByPhone(phone)?.let { return it }
        }
        val localId = db.customerDao().insert(
            CustomerEntity(tenantId = tenantId, name = name, phone = phone)
        )
        SyncWorker.triggerImmediateSync(context)
        return db.customerDao().getByLocalId(localId)!!
    }
}
