package lk.profitsnap.native_app.ui.screens.sales

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import lk.profitsnap.native_app.data.local.entity.ProductEntity
import lk.profitsnap.native_app.data.remote.SessionStore
import lk.profitsnap.native_app.data.repository.ProductRepository
import lk.profitsnap.native_app.data.repository.SaleRepository
import lk.profitsnap.native_app.ui.theme.ProfitSnapColors

@Composable
fun SalesScreen(onBack: () -> Unit, onScan: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    var tenantId by remember { mutableStateOf<String?>(null) }
    var products by remember { mutableStateOf<List<ProductEntity>>(emptyList()) }
    var query by remember { mutableStateOf("") }
    var selected by remember { mutableStateOf<ProductEntity?>(null) }
    var qty by remember { mutableStateOf("1") }
    var saving by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        val id = SessionStore(context).currentUserId() ?: return@LaunchedEffect
        tenantId = id
        ProductRepository(context, id).observeProducts().collectLatest { products = it }
    }

    Column(Modifier.fillMaxSize()) {
        TopAppBar(
            title = { Text("Record Sales") },
            navigationIcon = {
                IconButton(onClick = onBack) { Icon(Icons.Default.ArrowBack, contentDescription = "Back") }
            },
            actions = {
                IconButton(onClick = onScan) { Icon(Icons.Default.CameraAlt, contentDescription = "Scan") }
            },
            colors = TopAppBarDefaults.topAppBarColors(containerColor = ProfitSnapColors.Sales, titleContentColor = androidx.compose.ui.graphics.Color.White, navigationIconContentColor = androidx.compose.ui.graphics.Color.White, actionIconContentColor = androidx.compose.ui.graphics.Color.White),
        )

        if (selected == null) {
            OutlinedTextField(
                value = query,
                onValueChange = { query = it },
                label = { Text("Search items…") },
                modifier = Modifier.fillMaxWidth().padding(16.dp),
            )
            val matches = products.filter { it.name.contains(query, ignoreCase = true) || (it.code?.contains(query, ignoreCase = true) == true) }
            LazyColumn(Modifier.weight(1f)) {
                items(matches) { p ->
                    ListItem(
                        headlineContent = { Text(p.name) },
                        supportingContent = { Text("Stock: ${p.stock} ${p.unit} · ${p.sellPrice}") },
                        modifier = Modifier.clickable { selected = p; qty = "1" },
                    )
                    HorizontalDivider()
                }
            }
        } else {
            val product = selected!!
            Column(Modifier.padding(20.dp)) {
                Card(shape = RoundedCornerShape(16.dp)) {
                    Column(Modifier.padding(16.dp)) {
                        Text(product.name, style = MaterialTheme.typography.titleLarge)
                        Text("In stock: ${product.stock} ${product.unit} · Sell price ${product.sellPrice}")
                    }
                }
                Spacer(Modifier.height(20.dp))
                OutlinedTextField(
                    value = qty,
                    onValueChange = { qty = it },
                    label = { Text("Quantity sold") },
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(20.dp))
                Button(
                    onClick = {
                        val qtyNum = qty.toDoubleOrNull() ?: return@Button
                        val id = tenantId ?: return@Button
                        saving = true
                        scope.launch {
                            SaleRepository(context, id).recordSale(product.localId, qtyNum, product.sellPrice, product.avgCost)
                            saving = false
                            selected = null
                        }
                    },
                    enabled = !saving && (qty.toDoubleOrNull() ?: 0.0) > 0,
                    colors = ButtonDefaults.buttonColors(containerColor = ProfitSnapColors.Sales),
                    modifier = Modifier.fillMaxWidth().height(52.dp),
                ) {
                    Text(if (saving) "Recording…" else "Record Sale")
                }
                Spacer(Modifier.height(8.dp))
                TextButton(onClick = { selected = null }) { Text("Choose a different item") }
            }
        }
    }
}
