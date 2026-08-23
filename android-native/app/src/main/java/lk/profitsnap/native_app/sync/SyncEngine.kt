package lk.profitsnap.native_app.sync

import lk.profitsnap.native_app.data.local.AppDatabase
import lk.profitsnap.native_app.data.local.entity.*
import lk.profitsnap.native_app.data.remote.*

/**
 * The actual offline-first + auto-sync logic. Two phases, run in this
 * order every time sync fires:
 *
 *  1. PUSH — walk every table's PENDING rows and POST/PATCH them to
 *     Supabase, in dependency order (products before sales/stock_in/credit
 *     sales, since those reference a product's *remote* id via a foreign
 *     key — a sale made offline against a product that hasn't synced yet
 *     literally has no remote pid to attach until the product syncs first).
 *
 *  2. PULL — fetch each table from Supabase and upsert into Room, so
 *     changes made on the web app (or another device) show up here too.
 *     This is a simple "last write wins, full table pull" approach for
 *     v1 — good enough for a single-shop-owner usage pattern where
 *     conflicting edits from two devices at the same moment are rare, and
 *     safe to iterate to incremental/timestamp-based sync later without
 *     changing the Room schema.
 *
 * Runs are idempotent: syncing twice in a row with nothing pending is a
 * no-op beyond the pull refresh, so periodic WorkManager runs and
 * reconnect-triggered runs can overlap safely.
 */
class SyncEngine(
    private val db: AppDatabase,
    private val postgrest: PostgrestApi,
    private val tenantId: String,
) {
    suspend fun runFullSync() {
        pushProducts()
        pushStockIn()      // depends on products having a remoteId
        pushSales()         // depends on products having a remoteId
        pushCustomers()
        pushCreditSales()   // depends on customers + (optionally) products

        pullProducts()
        pullCustomers()
        pullCreditSales()
        // Sales/stock_in are append-only ledgers the app itself writes;
        // pulling them back isn't needed for single-device usage and adds
        // pull cost, so v1 skips it. Add if/when multi-device same-tenant
        // usage becomes real (e.g. two staff phones on one shop account).
    }

    // ── PUSH ─────────────────────────────────────────────────────────────

    private suspend fun pushProducts() {
        val pending = db.productDao().getByStatus(SyncStatus.PENDING)
        for (p in pending) {
            val dto = ProductDto(
                id = p.remoteId,
                code = p.code,
                name = p.name,
                unit = p.unit,
                avg_cost = p.avgCost,
                sell_price = p.sellPrice,
                stock = p.stock,
                created = p.created,
            )
            if (p.remoteId == null) {
                val created = postgrest.createProduct(dto).firstOrNull() ?: continue
                db.productDao().markSynced(p.localId, created.id!!)
            } else {
                postgrest.updateProduct(
                    "eq.${p.remoteId}",
                    mapOf("stock" to p.stock, "sell_price" to p.sellPrice, "avg_cost" to p.avgCost, "name" to p.name),
                )
                db.productDao().markSynced(p.localId, p.remoteId)
            }
        }
    }

    private suspend fun pushStockIn() {
        for (row in db.stockInDao().getPending()) {
            val productRemoteId = row.productRemoteId
                ?: db.productDao().getByLocalId(row.productLocalId)?.remoteId
                ?: continue // product hasn't synced yet — retry next sync pass
            val created = postgrest.createStockIn(
                StockInDto(pid = productRemoteId, qty = row.qty, cost = row.cost, date = row.date)
            ).firstOrNull() ?: continue
            db.stockInDao().markSynced(row.localId, created.id!!, productRemoteId)
        }
    }

    private suspend fun pushSales() {
        for (row in db.saleDao().getPending()) {
            val productRemoteId = row.productRemoteId
                ?: db.productDao().getByLocalId(row.productLocalId)?.remoteId
                ?: continue
            val created = postgrest.createSale(
                SaleDto(pid = productRemoteId, qty = row.qty, sell_price = row.sellPrice, cost_at_sale = row.costAtSale, date = row.date)
            ).firstOrNull() ?: continue
            db.saleDao().markSynced(row.localId, created.id!!, productRemoteId)
        }
    }

    private suspend fun pushCustomers() {
        for (c in db.customerDao().getPending()) {
            val created = postgrest.createCustomer(CustomerDto(name = c.name, phone = c.phone)).firstOrNull() ?: continue
            db.customerDao().markSynced(c.localId, created.id!!)
        }
    }

    private suspend fun pushCreditSales() {
        for (row in db.creditSaleDao().getPending()) {
            val custRemoteId = row.customerRemoteId ?: findCustomerRemoteId(row.customerLocalId) ?: continue
            val prodRemoteId = row.productLocalId?.let { db.productDao().getByLocalId(it)?.remoteId }

            if (row.remoteId == null) {
                val created = postgrest.createCreditSale(
                    CreditSaleDto(
                        customer_id = custRemoteId,
                        pid = prodRemoteId,
                        description = row.description,
                        amount = row.amount,
                        amount_settled = row.amountSettled,
                        qty = row.qty,
                        status = row.status,
                        date = row.date,
                    )
                ).firstOrNull() ?: continue
                db.creditSaleDao().markSynced(row.localId, created.id!!, custRemoteId, prodRemoteId)
            } else {
                // Existing row being updated (e.g. marked settled offline).
                postgrest.updateCreditSale(
                    "eq.${row.remoteId}",
                    mapOf("status" to row.status, "amount_settled" to row.amountSettled),
                )
                db.creditSaleDao().markSynced(row.localId, row.remoteId, custRemoteId, prodRemoteId)
            }
        }
    }

    private suspend fun findCustomerRemoteId(customerLocalId: Long): Long? =
        db.customerDao().getByLocalId(customerLocalId)?.remoteId

    // ── PULL ─────────────────────────────────────────────────────────────

    private suspend fun pullProducts() {
        val remote = postgrest.getProducts()
        val entities = remote.map { dto ->
            val existing = dto.id?.let { db.productDao().getByRemoteId(it) }
            ProductEntity(
                localId = existing?.localId ?: 0,
                remoteId = dto.id,
                tenantId = tenantId,
                code = dto.code,
                name = dto.name,
                unit = dto.unit,
                avgCost = dto.avg_cost,
                sellPrice = dto.sell_price,
                stock = dto.stock,
                created = dto.created,
                createdAt = existing?.createdAt ?: "",
                syncStatus = SyncStatus.SYNCED,
            )
        }
        db.productDao().upsertAll(entities)
    }

    private suspend fun pullCustomers() {
        val remote = postgrest.getCustomers()
        val entities = remote.map { dto ->
            val existing = dto.id?.let { db.customerDao().getByRemoteId(it) }
            CustomerEntity(
                localId = existing?.localId ?: 0,
                remoteId = dto.id,
                tenantId = tenantId,
                name = dto.name,
                phone = dto.phone,
                syncStatus = SyncStatus.SYNCED,
            )
        }
        db.customerDao().upsertAll(entities)
    }

    private suspend fun pullCreditSales() {
        val remote = postgrest.getCreditSales()
        val entities = remote.mapNotNull { dto ->
            val existing = dto.id?.let { db.creditSaleDao().getByRemoteId(it) }
            // A credit sale needs its customer already present locally to
            // resolve customerLocalId — since pullCustomers() always runs
            // first in runFullSync(), this should already be true; skip
            // (rather than crash) the rare row where it isn't yet, it'll
            // resolve on the next pull pass.
            val customer = db.customerDao().getByRemoteId(dto.customer_id) ?: return@mapNotNull null
            val product = dto.pid?.let { db.productDao().getByRemoteId(it) }
            CreditSaleEntity(
                localId = existing?.localId ?: 0,
                remoteId = dto.id,
                tenantId = tenantId,
                customerLocalId = customer.localId,
                customerRemoteId = dto.customer_id,
                productLocalId = product?.localId,
                productRemoteId = dto.pid,
                description = dto.description,
                amount = dto.amount,
                amountSettled = dto.amount_settled,
                qty = dto.qty,
                status = dto.status,
                dueDate = null,
                date = dto.date,
                syncStatus = SyncStatus.SYNCED,
            )
        }
        db.creditSaleDao().upsertAll(entities)
    }
}
