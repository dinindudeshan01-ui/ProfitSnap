package lk.profitsnap.native_app.ui.screens.home

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.flow.collectLatest
import lk.profitsnap.native_app.data.local.AppDatabase
import lk.profitsnap.native_app.ui.theme.ProfitSnapColors

private data class HomeTile(val label: String, val sub: String, val color: Color, val icon: androidx.compose.ui.graphics.vector.ImageVector, val route: String)

private val tiles = listOf(
    HomeTile("Record Sales", "Tap what you sold", ProfitSnapColors.Sales, Icons.Default.ShoppingCart, "sales"),
    HomeTile("Stock In", "New purchase arrived", ProfitSnapColors.Stock, Icons.Default.Inventory, "stock"),
    HomeTile("My Profit", "See how you did", ProfitSnapColors.Profit, Icons.Default.BarChart, "profit"),
    HomeTile("My Items", "Manage inventory", ProfitSnapColors.Products, Icons.Default.Inventory2, "items"),
    HomeTile("Credit Sale", "Sold on credit", ProfitSnapColors.CreditSale, Icons.Default.Handshake, "credit"),
)

@Composable
fun HomeScreen(onNavigate: (String) -> Unit) {
    val context = LocalContext.current
    val db = remember { AppDatabase.get(context) }

    // Reads straight from Room — this is offline-first in action: no
    // "loading from server" state needed, the local DB IS the state, and
    // it already reflects everything synced so far plus anything written
    // locally while offline.
    var productCount by remember { mutableStateOf(0) }
    LaunchedEffect(Unit) {
        db.productDao().observeAll().collectLatest { productCount = it.size }
    }

    Column(Modifier.fillMaxSize().background(ProfitSnapColors.Background)) {
        Column(Modifier.padding(20.dp)) {
            Text("ProfitSnap", style = MaterialTheme.typography.headlineSmall)
            Text("${productCount} items in catalog", color = ProfitSnapColors.Sub, style = MaterialTheme.typography.bodyMedium)
        }

        LazyVerticalGrid(
            columns = GridCells.Fixed(2),
            contentPadding = PaddingValues(16.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            items(tiles) { tile ->
                Card(
                    onClick = { onNavigate(tile.route) },
                    colors = CardDefaults.cardColors(containerColor = Color.White),
                    shape = RoundedCornerShape(16.dp),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Column(Modifier.padding(16.dp)) {
                        Box(
                            Modifier
                                .size(44.dp)
                                .background(tile.color.copy(alpha = 0.12f), RoundedCornerShape(12.dp)),
                            contentAlignment = Alignment.Center,
                        ) {
                            Icon(tile.icon, contentDescription = tile.label, tint = tile.color)
                        }
                        Spacer(Modifier.height(10.dp))
                        Text(tile.label, style = MaterialTheme.typography.titleMedium)
                        Text(tile.sub, style = MaterialTheme.typography.bodySmall, color = ProfitSnapColors.Sub)
                    }
                }
            }
        }
    }
}
