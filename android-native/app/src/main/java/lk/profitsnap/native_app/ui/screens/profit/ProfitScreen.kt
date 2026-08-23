package lk.profitsnap.native_app.ui.screens.profit

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.flow.collectLatest
import lk.profitsnap.native_app.data.remote.SessionStore
import lk.profitsnap.native_app.data.repository.DailyProfit
import lk.profitsnap.native_app.data.repository.ProfitRepository
import lk.profitsnap.native_app.ui.theme.ProfitSnapColors

@Composable
fun ProfitScreen(onBack: () -> Unit) {
    val context = LocalContext.current
    var today by remember { mutableStateOf(DailyProfit(0.0, 0.0, 0)) }

    LaunchedEffect(Unit) {
        SessionStore(context).currentUserId() ?: return@LaunchedEffect
        ProfitRepository(context).observeToday().collectLatest { today = it }
    }

    Column(Modifier.fillMaxSize()) {
        TopAppBar(
            title = { Text("My Profit") },
            navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.Default.ArrowBack, contentDescription = "Back") } },
            colors = TopAppBarDefaults.topAppBarColors(containerColor = ProfitSnapColors.Profit, titleContentColor = Color.White, navigationIconContentColor = Color.White),
        )
        Column(Modifier.padding(20.dp)) {
            Card(shape = RoundedCornerShape(16.dp), modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(20.dp)) {
                    Text("TODAY'S PROFIT", style = MaterialTheme.typography.labelMedium, color = ProfitSnapColors.Sub)
                    Text("Rs ${today.profit.toInt()}", style = MaterialTheme.typography.headlineLarge, color = ProfitSnapColors.Profit)
                    Spacer(Modifier.height(16.dp))
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Column { Text("Revenue", color = ProfitSnapColors.Sub, style = MaterialTheme.typography.bodySmall); Text("Rs ${today.revenue.toInt()}") }
                        Column { Text("Cost", color = ProfitSnapColors.Sub, style = MaterialTheme.typography.bodySmall); Text("Rs ${today.cost.toInt()}") }
                        Column { Text("Sales", color = ProfitSnapColors.Sub, style = MaterialTheme.typography.bodySmall); Text("${today.saleCount}") }
                    }
                }
            }
        }
    }
}
