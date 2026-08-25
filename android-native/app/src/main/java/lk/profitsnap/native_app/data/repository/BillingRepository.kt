package lk.profitsnap.native_app.data.repository

import android.app.Activity
import android.content.Context
import com.android.billingclient.api.*
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.suspendCancellableCoroutine
import lk.profitsnap.native_app.data.remote.SessionStore
import lk.profitsnap.native_app.data.remote.SupabaseClient
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import kotlin.coroutines.resume

/**
 * Wraps the Play Billing Library for ProfitSnap Pro subscriptions.
 *
 * Setup needed before this works (do this in Play Console, not in code):
 *   1. Create the app listing in Play Console (needs a signed release
 *      build uploaded to at least Internal Testing).
 *   2. Under Monetize → Subscriptions, create a subscription product —
 *      note its exact product ID and put it in [SUBSCRIPTION_PRODUCT_ID]
 *      below.
 *   3. Dialog carrier billing then appears automatically as a payment
 *      option for Sri Lankan users at checkout — nothing else to do for
 *      that part specifically.
 *   4. For server-side verification (confirming a purchase actually went
 *      through before granting credits — never trust the client-side
 *      purchase result alone), see the /api/payments/play-billing/verify
 *      route and its GOOGLE_PLAY_SERVICE_ACCOUNT_JSON setup in
 *      .env.example.
 *
 * Until a real subscription product exists in Play Console, calling
 * launchPurchaseFlow() will fail with an ITEM_UNAVAILABLE billing
 * response — that's expected pre-setup, not a bug in this code.
 */
private const val SUBSCRIPTION_PRODUCT_ID = "profitsnap_pro_monthly" // must match Play Console exactly

sealed class PurchaseOutcome {
    data class Success(val purchaseToken: String) : PurchaseOutcome()
    data class Failed(val message: String) : PurchaseOutcome()
    object Cancelled : PurchaseOutcome()
}

class BillingRepository(private val context: Context) {
    private var billingClient: BillingClient? = null

    private fun ensureConnected(onReady: () -> Unit) {
        val client = billingClient ?: BillingClient.newBuilder(context)
            .setListener { _, _ -> /* handled per-purchase in launchPurchaseFlow's own listener below */ }
            .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
            .build()
            .also { billingClient = it }

        if (client.isReady) {
            onReady()
            return
        }
        client.startConnection(object : BillingClientStateListener {
            override fun onBillingSetupFinished(result: BillingResult) {
                if (result.responseCode == BillingClient.BillingResponseCode.OK) onReady()
            }
            override fun onBillingServiceDisconnected() { /* will reconnect on next call */ }
        })
    }

    /** Launches Play Billing's native checkout sheet for the Pro
     * subscription. Dialog carrier billing, cards, and any other payment
     * method the user has on Play all appear inside this sheet — this
     * code doesn't need to know or care which one they pick. */
    suspend fun launchPurchaseFlow(activity: Activity): PurchaseOutcome = suspendCancellableCoroutine { cont ->
        ensureConnected {
            val client = billingClient ?: run {
                cont.resume(PurchaseOutcome.Failed("Billing not available"))
                return@ensureConnected
            }

            val productList = listOf(
                QueryProductDetailsParams.Product.newBuilder()
                    .setProductId(SUBSCRIPTION_PRODUCT_ID)
                    .setProductType(BillingClient.ProductType.SUBS)
                    .build()
            )
            val params = QueryProductDetailsParams.newBuilder().setProductList(productList).build()

            client.queryProductDetailsAsync(params) { billingResult, productDetailsResult ->
                val productDetails = productDetailsResult.productDetailsList?.firstOrNull()
                if (billingResult.responseCode != BillingClient.BillingResponseCode.OK || productDetails == null) {
                    cont.resume(PurchaseOutcome.Failed("Subscription not available yet (billingResult=${billingResult.responseCode})"))
                    return@queryProductDetailsAsync
                }

                val offerToken = productDetails.subscriptionOfferDetails?.firstOrNull()?.offerToken
                if (offerToken == null) {
                    cont.resume(PurchaseOutcome.Failed("No subscription offer configured"))
                    return@queryProductDetailsAsync
                }

                val productDetailsParamsList = listOf(
                    BillingFlowParams.ProductDetailsParams.newBuilder()
                        .setProductDetails(productDetails)
                        .setOfferToken(offerToken)
                        .build()
                )
                val flowParams = BillingFlowParams.newBuilder()
                    .setProductDetailsParamsList(productDetailsParamsList)
                    .build()

                // Re-create the client with a listener bound to this specific
                // continuation, since PurchasesUpdatedListener is set once at
                // client construction — simplest correct way to route the
                // async result back to this specific call without a shared
                // mutable callback field.
                val listeningClient = BillingClient.newBuilder(context)
                    .setListener { billingResult2, purchases ->
                        when {
                            billingResult2.responseCode == BillingClient.BillingResponseCode.OK && purchases != null -> {
                                val purchase = purchases.firstOrNull()
                                if (purchase != null) {
                                    cont.resume(PurchaseOutcome.Success(purchase.purchaseToken))
                                } else {
                                    cont.resume(PurchaseOutcome.Failed("No purchase returned"))
                                }
                            }
                            billingResult2.responseCode == BillingClient.BillingResponseCode.USER_CANCELED -> {
                                cont.resume(PurchaseOutcome.Cancelled)
                            }
                            else -> {
                                cont.resume(PurchaseOutcome.Failed("Purchase failed (${billingResult2.responseCode})"))
                            }
                        }
                    }
                    .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
                    .build()

                listeningClient.startConnection(object : BillingClientStateListener {
                    override fun onBillingSetupFinished(result: BillingResult) {
                        listeningClient.launchBillingFlow(activity, flowParams)
                    }
                    override fun onBillingServiceDisconnected() {}
                })
            }
        }
    }

    /** Sends the purchase token to our backend for server-side
     * verification against the Play Developer API — the client-side
     * "Success" above only means the checkout sheet completed, NOT that
     * the purchase is genuine (a rooted/tampered device could fake that
     * locally). Credits/subscription activation only happen after this
     * server call confirms it via Google's API. */
    suspend fun verifyPurchaseWithServer(purchaseToken: String, tenantId: String): Boolean {
        val sessionStore = SessionStore(context)
        val api = SupabaseClient.appBackend(sessionStore)
        val body = """{"purchaseToken":"$purchaseToken","tenantId":"$tenantId"}"""
            .toRequestBody("application/json".toMediaType())
        return try {
            val response = api.create(lk.profitsnap.native_app.data.remote.PlayBillingVerifyApi::class.java)
                .verify(body)
            response.isSuccessful
        } catch (e: Exception) {
            false
        }
    }
}
