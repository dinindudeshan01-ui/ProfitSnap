package lk.profitsnap.native_app.data.repository

import android.content.Context
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import lk.profitsnap.native_app.data.local.AppDatabase
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

data class DailyProfit(
    val revenue: Double,
    val cost: Double,
    val saleCount: Int,
) {
    val profit: Double get() = revenue - cost
}

class ProfitRepository(context: Context) {
    private val db = AppDatabase.get(context)

    /** Today's revenue/cost/profit — uses cost-at-time-of-sale (stored on
     * each SaleEntity), same as the web app, so historical profit figures
     * don't silently shift if a product's average cost changes later. */
    fun observeToday(): Flow<DailyProfit> =
        db.saleDao().observeForDate(today()).map { sales ->
            val revenue = sales.sumOf { it.qty * it.sellPrice }
            val cost = sales.sumOf { it.qty * it.costAtSale }
            DailyProfit(revenue = revenue, cost = cost, saleCount = sales.size)
        }

    private fun today(): String = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())
}
