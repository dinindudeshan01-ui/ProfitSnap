package lk.profitsnap.native_app.data.repository

import android.content.Context
import lk.profitsnap.native_app.data.local.AppDatabase
import lk.profitsnap.native_app.data.remote.ScanApi
import lk.profitsnap.native_app.data.remote.ScanResponse
import lk.profitsnap.native_app.data.remote.ScanRowDto
import lk.profitsnap.native_app.data.remote.SessionStore
import lk.profitsnap.native_app.data.remote.SupabaseClient
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File

sealed class ScanOutcome {
    data class Success(val rowsApplied: Int, val creditsCharged: Int?) : ScanOutcome()
    data class Failed(val message: String) : ScanOutcome()
}

/**
 * The native equivalent of the web app's ScanScreen.saveRowsToInventory().
 * OCR itself stays server-side (see ScanApi.kt for why) — this class's job
 * is: send the photo, get rows back, then apply each row through the
 * *same* offline-first repositories the manual-entry screens use, so a
 * scanned sale and a manually-typed sale go through identical code paths
 * (same stock decrement/increment logic, same sync behavior).
 */
class ScanRepository(private val context: Context, private val tenantId: String) {
    private val db = AppDatabase.get(context)
    private val sessionStore = SessionStore(context)
    private val scanApi = SupabaseClient.appBackend(sessionStore).create(ScanApi::class.java)

    private val saleRepo = SaleRepository(context, tenantId)
    private val stockInRepo = StockInRepository(context, tenantId)
    private val creditSaleRepo = CreditSaleRepository(context, tenantId)

    suspend fun scanAndApply(photoFile: File, scanType: String): ScanOutcome {
        val requestFile = photoFile.asRequestBody("image/jpeg".toMediaTypeOrNull())
        val photoPart = MultipartBody.Part.createFormData("photo", photoFile.name, requestFile)
        val scanTypePart = scanType.toRequestBody("text/plain".toMediaTypeOrNull())
        val isRetakePart = "false".toRequestBody("text/plain".toMediaTypeOrNull())

        val response = try {
            scanApi.scan(photoPart, scanTypePart, isRetakePart)
        } catch (e: Exception) {
            return ScanOutcome.Failed(e.message ?: "Network error — check your connection and try again")
        }

        val body = response.body()
        if (!response.isSuccessful || body == null || !body.ok) {
            return ScanOutcome.Failed(body?.error ?: "Couldn't read the sheet — try again with better lighting")
        }

        val rows = body.rows ?: emptyList()
        var applied = 0
        for (row in rows) {
            if (applyRow(row, scanType)) applied++
        }
        return ScanOutcome.Success(rowsApplied = applied, creditsCharged = body.creditsCharged)
    }

    private suspend fun applyRow(row: ScanRowDto, scanType: String): Boolean {
        return when (scanType) {
            "setup", "stock_in" -> {
                val name = row.name?.trim().orEmpty()
                val qty = row.qty?.toDoubleOrNull() ?: return false
                if (name.isEmpty() || qty <= 0) return false
                val productLocalId = findOrCreateProduct(name, row.code, row.cost?.toDoubleOrNull(), row.sell?.toDoubleOrNull())
                stockInRepo.recordStockIn(productLocalId, qty, row.cost?.toDoubleOrNull() ?: 0.0)
                true
            }
            "sales" -> {
                val name = row.name?.trim().orEmpty()
                val qty = row.qty?.toDoubleOrNull() ?: return false
                if (name.isEmpty() || qty <= 0) return false
                val match = findProductByNameOrCode(name, row.code) ?: return false
                saleRepo.recordSale(match.localId, qty, match.sellPrice, match.avgCost)
                true
            }
            "credit_sale" -> {
                val customerName = row.customer_name?.trim().orEmpty()
                val amount = row.amount?.toDoubleOrNull() ?: return false
                if (customerName.isEmpty() || amount <= 0) return false
                creditSaleRepo.recordCreditSale(
                    customerName = customerName,
                    customerPhone = row.customer_phone?.trim(),
                    description = row.description?.trim(),
                    amount = amount,
                    productLocalId = null, // OCR rows aren't catalog-linked; matches the web app's scan flow, which also only links products via the manual-entry ItemPicker, not OCR text
                    qty = null,
                )
                true
            }
            else -> false
        }
    }

    private suspend fun findProductByNameOrCode(name: String, code: String?) =
        db.productDao().getByStatus(lk.profitsnap.native_app.data.local.entity.SyncStatus.SYNCED)
            .plus(db.productDao().getByStatus(lk.profitsnap.native_app.data.local.entity.SyncStatus.PENDING))
            .firstOrNull {
                it.name.equals(name, ignoreCase = true) || (code != null && it.code?.equals(code, ignoreCase = true) == true)
            }

    private suspend fun findOrCreateProduct(name: String, code: String?, cost: Double?, sell: Double?): Long {
        val existing = findProductByNameOrCode(name, code)
        if (existing != null) return existing.localId
        val productRepo = ProductRepository(context, tenantId)
        return productRepo.addProduct(
            code = code,
            name = name,
            unit = "pcs",
            avgCost = cost ?: 0.0,
            sellPrice = sell ?: 0.0,
            openingStock = 0.0,
        )
    }
}
