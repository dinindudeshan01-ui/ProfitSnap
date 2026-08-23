package lk.profitsnap.native_app.data.remote

import retrofit2.http.*

// ── GoTrue (auth.v1) ─────────────────────────────────────────────────────

data class SignInRequest(val email: String, val password: String)
data class RefreshRequest(val refresh_token: String)
data class AuthResponse(
    val access_token: String,
    val refresh_token: String,
    val user: AuthUser,
)
data class AuthUser(val id: String, val email: String?)

interface AuthApi {
    @POST("token?grant_type=password")
    suspend fun signIn(@Body body: SignInRequest): AuthResponse

    @POST("token?grant_type=refresh_token")
    suspend fun refresh(@Body body: RefreshRequest): AuthResponse
}

// ── PostgREST (rest/v1) — one row-DTO per table, matching the columns the
// web app's Supabase client already reads/writes. Field names use the
// Postgres snake_case column names directly since Gson serializes as-is. ──

data class ProductDto(
    val id: Long? = null,
    val code: String?,
    val name: String,
    val unit: String,
    val avg_cost: Double,
    val sell_price: Double,
    val stock: Double,
    val created: String?,
)

data class SaleDto(
    val id: Long? = null,
    val pid: Long,
    val qty: Double,
    val sell_price: Double,
    val cost_at_sale: Double,
    val date: String,
)

data class StockInDto(
    val id: Long? = null,
    val pid: Long,
    val qty: Double,
    val cost: Double,
    val date: String,
)

data class CustomerDto(
    val id: Long? = null,
    val name: String,
    val phone: String?,
)

data class CreditSaleDto(
    val id: Long? = null,
    val customer_id: Long,
    val pid: Long?,
    val description: String?,
    val amount: Double,
    val amount_settled: Double = 0.0,
    val qty: Double?,
    val status: String = "open",
    val date: String,
)

interface PostgrestApi {
    // Prefer: return=representation makes Supabase send back the inserted
    // row (with its server-assigned id) in the response body — that's how
    // markSynced() below learns the remoteId to store locally.

    @GET("products")
    suspend fun getProducts(@Query("select") select: String = "*"): List<ProductDto>

    @POST("products")
    @Headers("Prefer: return=representation")
    suspend fun createProduct(@Body body: ProductDto): List<ProductDto>

    @PATCH("products")
    suspend fun updateProduct(@Query("id") idFilter: String, @Body body: Map<String, Any?>)

    @GET("sales")
    suspend fun getSales(@Query("date") dateFilter: String? = null): List<SaleDto>

    @POST("sales")
    @Headers("Prefer: return=representation")
    suspend fun createSale(@Body body: SaleDto): List<SaleDto>

    @GET("stock_in")
    suspend fun getStockIn(): List<StockInDto>

    @POST("stock_in")
    @Headers("Prefer: return=representation")
    suspend fun createStockIn(@Body body: StockInDto): List<StockInDto>

    @GET("customers")
    suspend fun getCustomers(): List<CustomerDto>

    @POST("customers")
    @Headers("Prefer: return=representation")
    suspend fun createCustomer(@Body body: CustomerDto): List<CustomerDto>

    @GET("credit_sales")
    suspend fun getCreditSales(): List<CreditSaleDto>

    @POST("credit_sales")
    @Headers("Prefer: return=representation")
    suspend fun createCreditSale(@Body body: CreditSaleDto): List<CreditSaleDto>

    @PATCH("credit_sales")
    suspend fun updateCreditSale(@Query("id") idFilter: String, @Body body: Map<String, Any?>)
}
