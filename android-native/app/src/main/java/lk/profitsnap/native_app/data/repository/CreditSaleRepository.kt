package lk.profitsnap.native_app.data.repository

import android.content.Context
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import lk.profitsnap.native_app.data.local.AppDatabase
import lk.profitsnap.native_app.data.local.entity.CreditSaleEntity
import lk.profitsnap.native_app.data.local.entity.CustomerEntity
import lk.profitsnap.native_app.sync.SyncWorker
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

data class CustomerDebt(
    val customer: CustomerEntity,
    val sales: List<CreditSaleEntity>,
) {
    val totalOwed: Double get() = sales.sumOf { it.amount - it.amountSettled }
}

class CreditSaleRepository(private val context: Context, private val tenantId: String) {
    private val db = AppDatabase.get(context)
    private val customers = CustomerRepository(context, tenantId)
    private val products = ProductRepository(context, tenantId)

    /** Same shape as the web app's /credit-sales page: group open credit
     * sales by customer, sorted by who owes the most. */
    fun observeOpenDebtsByCustomer(): Flow<List<CustomerDebt>> =
        combine(db.customerDao().observeAll(), db.creditSaleDao().observeOpen()) { customerList, saleList ->
            val byCustomer = customerList.associateBy { it.localId }
            saleList
                .groupBy { it.customerLocalId }
                .mapNotNull { (customerLocalId, sales) ->
                    byCustomer[customerLocalId]?.let { CustomerDebt(it, sales) }
                }
                .sortedByDescending { it.totalOwed }
        }

    /** Records a credit sale. If [productLocalId] is set, decrements stock
     * the same way a normal sale does (clamped at 0) — mirrors the web
     * app's ItemPicker-linked manual entry exactly. If null, this is a
     * free-text credit sale with no catalog link and stock is untouched. */
    suspend fun recordCreditSale(
        customerName: String,
        customerPhone: String?,
        description: String?,
        amount: Double,
        productLocalId: Long?,
        qty: Double?,
    ) {
        val customer = customers.findOrCreate(customerName, customerPhone)
        val product = productLocalId?.let { db.productDao().getByLocalId(it) }

        db.creditSaleDao().insert(
            CreditSaleEntity(
                tenantId = tenantId,
                customerLocalId = customer.localId,
                customerRemoteId = customer.remoteId,
                productLocalId = productLocalId,
                productRemoteId = product?.remoteId,
                description = description,
                amount = amount,
                qty = qty,
                status = "open",
                dueDate = null,
                date = today(),
            )
        )

        if (product != null && qty != null && qty > 0) {
            products.decrementStockForSale(product.localId, qty)
        }
        SyncWorker.triggerImmediateSync(context)
    }

    suspend fun markSettled(saleLocalId: Long) {
        db.creditSaleDao().markSettledLocally(saleLocalId)
        SyncWorker.triggerImmediateSync(context)
    }

    private fun today(): String = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())
}
