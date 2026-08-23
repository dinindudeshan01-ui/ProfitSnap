package lk.profitsnap.native_app.ui.screens.items

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import lk.profitsnap.native_app.data.local.entity.ProductEntity
import lk.profitsnap.native_app.data.remote.SessionStore
import lk.profitsnap.native_app.data.repository.ProductRepository
import lk.profitsnap.native_app.ui.theme.ProfitSnapColors

@Composable
fun ItemsScreen(onBack: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    var tenantId by remember { mutableStateOf<String?>(null) }
    var products by remember { mutableStateOf<List<ProductEntity>>(emptyList()) }
    var showAddSheet by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        val id = SessionStore(context).currentUserId() ?: return@LaunchedEffect
        tenantId = id
        ProductRepository(context, id).observeProducts().collectLatest { products = it }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("My Items") },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.Default.ArrowBack, contentDescription = "Back") } },
                actions = { IconButton(onClick = { showAddSheet = true }) { Icon(Icons.Default.Add, contentDescription = "Add item") } },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = ProfitSnapColors.Products, titleContentColor = Color.White, navigationIconContentColor = Color.White, actionIconContentColor = Color.White),
            )
        },
    ) { padding ->
        LazyColumn(Modifier.fillMaxSize().padding(padding)) {
            items(products) { p ->
                ListItem(
                    headlineContent = { Text(p.name) },
                    supportingContent = { Text("${p.stock} ${p.unit} · cost ${p.avgCost} · sell ${p.sellPrice}") },
                )
                HorizontalDivider()
            }
            if (products.isEmpty()) {
                item {
                    Box(Modifier.fillMaxWidth().padding(32.dp), contentAlignment = androidx.compose.ui.Alignment.Center) {
                        Text("No items yet — tap + to add one", color = ProfitSnapColors.Sub)
                    }
                }
            }
        }
    }

    if (showAddSheet) {
        AddItemSheet(
            onDismiss = { showAddSheet = false },
            onSave = { name, code, unit, cost, sell, stock ->
                val id = tenantId ?: return@AddItemSheet
                scope.launch {
                    ProductRepository(context, id).addProduct(code.ifBlank { null }, name, unit, cost, sell, stock)
                    showAddSheet = false
                }
            },
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AddItemSheet(
    onDismiss: () -> Unit,
    onSave: (name: String, code: String, unit: String, cost: Double, sell: Double, stock: Double) -> Unit,
) {
    var name by remember { mutableStateOf("") }
    var code by remember { mutableStateOf("") }
    var unit by remember { mutableStateOf("pcs") }
    var cost by remember { mutableStateOf("") }
    var sell by remember { mutableStateOf("") }
    var stock by remember { mutableStateOf("0") }

    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(Modifier.padding(20.dp)) {
            Text("New Item", style = MaterialTheme.typography.titleLarge)
            Spacer(Modifier.height(16.dp))
            OutlinedTextField(value = name, onValueChange = { name = it }, label = { Text("Item name") }, modifier = Modifier.fillMaxWidth())
            Spacer(Modifier.height(10.dp))
            OutlinedTextField(value = code, onValueChange = { code = it }, label = { Text("Code (optional)") }, modifier = Modifier.fillMaxWidth())
            Spacer(Modifier.height(10.dp))
            OutlinedTextField(value = unit, onValueChange = { unit = it }, label = { Text("Unit") }, modifier = Modifier.fillMaxWidth())
            Spacer(Modifier.height(10.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlinedTextField(value = cost, onValueChange = { cost = it }, label = { Text("Cost") }, modifier = Modifier.weight(1f))
                OutlinedTextField(value = sell, onValueChange = { sell = it }, label = { Text("Sell price") }, modifier = Modifier.weight(1f))
            }
            Spacer(Modifier.height(10.dp))
            OutlinedTextField(value = stock, onValueChange = { stock = it }, label = { Text("Opening stock") }, modifier = Modifier.fillMaxWidth())
            Spacer(Modifier.height(20.dp))
            Button(
                onClick = {
                    onSave(
                        name.trim(), code.trim(), unit.trim().ifBlank { "pcs" },
                        cost.toDoubleOrNull() ?: 0.0, sell.toDoubleOrNull() ?: 0.0, stock.toDoubleOrNull() ?: 0.0,
                    )
                },
                enabled = name.isNotBlank(),
                colors = ButtonDefaults.buttonColors(containerColor = ProfitSnapColors.Products),
                modifier = Modifier.fillMaxWidth().height(52.dp),
            ) { Text("Save Item") }
            Spacer(Modifier.height(20.dp))
        }
    }
}
