package lk.profitsnap.native_app.data.remote

import okhttp3.MultipartBody
import retrofit2.Response
import retrofit2.http.Multipart
import retrofit2.http.POST
import retrofit2.http.Part

/**
 * Calls the *existing* Next.js API route (`/api/scan`) — same contract the
 * web app's ScanScreen already uses (multipart photo + scanType + retake
 * flag). Deliberately not reimplementing OCR on-device: Gemini vision +
 * the credit-charging logic already live server-side, and duplicating
 * that here would mean two places to keep in sync (and two places for the
 * credit ledger to be wrong). This requires network — scanning genuinely
 * needs connectivity, since it's charging Gemini API credits server-side;
 * the offline-first guarantee applies to *recording* the resulting rows
 * (via SaleRepository/StockInRepository/CreditSaleRepository) once OCR
 * returns, not to the OCR call itself.
 */
data class ScanRowDto(
    val code: String? = null,
    val name: String? = null,
    val qty: String? = null,
    val cost: String? = null,
    val sell: String? = null,
    val customer_name: String? = null,
    val customer_phone: String? = null,
    val description: String? = null,
    val amount: String? = null,
)

data class ScanResponse(
    val ok: Boolean,
    val rows: List<ScanRowDto>? = null,
    val scanId: String? = null,
    val creditsCharged: Int? = null,
    val chargeType: String? = null,
    val error: String? = null,
)

interface ScanApi {
    @Multipart
    @POST("api/scan")
    suspend fun scan(
        @Part photo: MultipartBody.Part,
        @Part("scanType") scanType: okhttp3.RequestBody,
        @Part("isRetake") isRetake: okhttp3.RequestBody,
        @Part("scanId") scanId: okhttp3.RequestBody? = null,
    ): Response<ScanResponse>
}
