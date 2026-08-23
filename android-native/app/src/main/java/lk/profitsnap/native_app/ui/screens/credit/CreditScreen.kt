package lk.profitsnap.native_app.ui.screens.credit

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.Send
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
import lk.profitsnap.native_app.data.repository.CreditSaleRepository
import lk.profitsnap.native_app.data.repository.CustomerDebt
import lk.profitsnap.native_app.data.repository.ProductRepository
import lk.profitsnap.native_app.ui.theme.ProfitSnapColors

@Composable
fun CreditScreen(onBack: () -> Unit, onScan: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    var tenantId by remember { mutableStateOf<String?>(null) }
    var debts by remember { mutableStateOf<List<CustomerDebt>>(emptyList()) }
    var showAddSheet by remember { mutableStateOf(false) }
    var repo by remember { mutableStateOf<CreditSaleRepository?>(null) }

    LaunchedEffect(Unit) {
        val id = SessionStore(context).currentUserId() ?: return@LaunchedEffect
        tenantId = id
        val r = CreditSaleRepository(context, id)
        repo = r
        r.observeOpenDebtsByCustomer().collectLatest { debts = it }
    }

    val totalOwed = debts.sumOf { it.totalOwed }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Credit Sales") },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.Default.ArrowBack, contentDescription = "Back") } },
                actions = {
                    IconButton(onClick = onScan) { Icon(Icons.Default.CameraAlt, contentDescription = "Scan") }
                    IconButton(onClick = { showAddSheet = true }) { Icon(Icons.Default.Add, contentDescription = "Add") }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = ProfitSnapColors.CreditSale, titleContentColor = Color.White, navigationIconContentColor = Color.White, actionIconContentColor = Color.White),
            )
        },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            Card(Modifier.fillMaxWidth().padding(16.dp), shape = RoundedCornerShape(16.dp)) {
                Column(Modifier.padding(16.dp)) {
                    Text("TOTAL OWED", style = MaterialTheme.typography.labelSmall, color = ProfitSnapColors.Sub)
                    Text("Rs ${totalOwed.toInt()}", style = MaterialTheme.typography.headlineMedium, color = ProfitSnapColors.CreditSale)
                }
            }

            if (debts.isEmpty()) {
                Box(Modifier.fillMaxWidth().padding(32.dp), contentAlignment = androidx.compose.ui.Alignment.Center) {
                    Text("No credit sales yet", color = ProfitSnapColors.Sub)
                }
            } else {
                LazyColumn(Modifier.weight(1f)) {
                    items(debts) { debt ->
                        var expanded by remember { mutableStateOf(false) }
                        Card(
                            Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp),
                            shape = RoundedCornerShape(12.dp),
                        ) {
                            Column(Modifier.padding(14.dp)) {
                                Row(
                                    Modifier.fillMaxWidth().clickableSimple { expanded = !expanded },
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                ) {
                                    Column {
                                        Text(debt.customer.name, style = MaterialTheme.typography.titleMedium)
                                        debt.customer.phone?.let { Text(it, color = ProfitSnapColors.Sub, style = MaterialTheme.typography.bodySmall) }
                                    }
                                    Text("Rs ${debt.totalOwed.toInt()}", color = ProfitSnapColors.CreditSale, style = MaterialTheme.typography.titleMedium)
                                }
                                if (expanded) {
                                    Spacer(Modifier.height(8.dp))
                                    debt.sales.forEach { sale ->
                                        val owed = sale.amount - sale.amountSettled
                                        Row(
                                            Modifier.fillMaxWidth().padding(vertical = 4.dp),
                                            horizontalArrangement = Arrangement.SpaceBetween,
                                        ) {
                                            Text(sale.description ?: "—", style = MaterialTheme.typography.bodySmall)
                                            Row {
                                                Text("Rs ${owed.toInt()}", style = MaterialTheme.typography.bodySmall)
                                                Spacer(Modifier.width(8.dp))
                                                TextButton(onClick = { scope.launch { repo?.markSettled(sale.localId) } }) {
                                                    Text("Settle")
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    if (showAddSheet) {
        AddCreditSaleSheet(
            onDismiss = { showAddSheet = false },
            onSave = { name, phone, description, amount, product, qty ->
                val r = repo ?: return@AddCreditSaleSheet
                scope.launch {
                    r.recordCreditSale(name, phone, description, amount, product?.localId, qty)
                    showAddSheet = false
                }
            },
        )
    }
}

private fun Modifier.clickableSimple(onClick: () -> Unit) =
    this.then(androidx.compose.foundation.clickable(onClick = onClick))

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AddCreditSaleSheet(
    onDismiss: () -> Unit,
    onSave: (name: String, phone: String?, description: String?, amount: Double, product: ProductEntity?, qty: Double?) -> Unit,
) {
    val context = LocalContext.current
    var tenantId by remember { mutableStateOf<String?>(null) }
    var products by remember { mutableStateOf<List<ProductEntity>>(emptyList()) }

    LaunchedEffect(Unit) {
        val id = SessionStore(context).currentUserId() ?: return@LaunchedEffect
        tenantId = id
        ProductRepository(context, id).observeProducts().collectLatest { products = it }
    }

    var name by remember { mutableStateOf("") }
    var phone by remember { mutableStateOf("") }
    var itemQuery by remember { mutableStateOf("") }
    var selectedProduct by remember { mutableStateOf<ProductEntity?>(null) }
    var qty by remember { mutableStateOf("1") }
    var amount by remember { mutableStateOf("") }
    var showMatches by remember { mutableStateOf(false) }

    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(Modifier.padding(20.dp)) {
            Text("Credit Sale", style = MaterialTheme.typography.titleLarge)
            Spacer(Modifier.height(16.dp))
            OutlinedTextField(value = name, onValueChange = { name = it }, label = { Text("Customer Name") }, modifier = Modifier.fillMaxWidth())
            Spacer(Modifier.height(10.dp))
            OutlinedTextField(value = phone, onValueChange = { phone = it }, label = { Text("Phone Number") }, modifier = Modifier.fillMaxWidth())
            Spacer(Modifier.height(10.dp))

            // ── QuickBooks-style item field: search catalog, or fall
            // through as free text if nothing's picked ──────────────────
            if (selectedProduct != null) {
                Card(shape = RoundedCornerShape(12.dp)) {
                    Row(
                        Modifier.fillMaxWidth().padding(12.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = androidx.compose.ui.Alignment.CenterVertically,
                    ) {
                        Column {
                            Text(selectedProduct!!.name, style = MaterialTheme.typography.bodyMedium)
                            Text("In stock: ${selectedProduct!!.stock} ${selectedProduct!!.unit}", style = MaterialTheme.typography.labelSmall, color = ProfitSnapColors.Sub)
                        }
                        TextButton(onClick = { selectedProduct = null; itemQuery = "" }) { Text("Clear") }
                    }
                }
                Spacer(Modifier.height(10.dp))
                OutlinedTextField(
                    value = qty,
                    onValueChange = { q ->
                        qty = q
                        val qtyNum = q.toDoubleOrNull() ?: 0.0
                        amount = (qtyNum * (selectedProduct?.sellPrice ?: 0.0)).toString()
                    },
                    label = { Text("Qty") },
                    modifier = Modifier.fillMaxWidth(),
                )
            } else {
                Column {
                    OutlinedTextField(
                        value = itemQuery,
                        onValueChange = { itemQuery = it; showMatches = true },
                        label = { Text("Item / Note") },
                        modifier = Modifier.fillMaxWidth(),
                    )
                    if (showMatches && itemQuery.isNotBlank()) {
                        val matches = products.filter { it.name.contains(itemQuery, ignoreCase = true) }.take(5)
                        Card(shape = RoundedCornerShape(12.dp), modifier = Modifier.fillMaxWidth().padding(top = 4.dp)) {
                            Column {
                                matches.forEach { p ->
                                    ListItem(
                                        headlineContent = { Text(p.name) },
                                        supportingContent = { Text("${p.stock} ${p.unit} left") },
                                        modifier = Modifier.clickableSimple {
                                            selectedProduct = p
                                            itemQuery = p.name
                                            qty = "1"
                                            amount = p.sellPrice.toString()
                                            showMatches = false
                                        },
                                    )
                                }
                                if (matches.none { it.name.equals(itemQuery, ignoreCase = true) }) {
                                    TextButton(
                                        onClick = {
                                            // Free text stays free text — creating a brand-new
                                            // catalog product inline (like the web app's
                                            // ItemPicker) is the natural next step here; kept
                                            // out of v1 to ship the core flow first.
                                            showMatches = false
                                        },
                                    ) { Text("Use \"$itemQuery\" as a note (no stock link)") }
                                }
                            }
                        }
                    }
                }
            }

            Spacer(Modifier.height(10.dp))
            OutlinedTextField(value = amount, onValueChange = { amount = it }, label = { Text("Amount") }, modifier = Modifier.fillMaxWidth())
            Spacer(Modifier.height(20.dp))
            Button(
                onClick = {
                    val amt = amount.toDoubleOrNull() ?: return@Button
                    onSave(
                        name.trim(), phone.trim().ifBlank { null },
                        if (selectedProduct == null) itemQuery.trim().ifBlank { null } else null,
                        amt, selectedProduct, selectedProduct?.let { qty.toDoubleOrNull() },
                    )
                },
                enabled = name.isNotBlank() && (amount.toDoubleOrNull() ?: 0.0) > 0,
                colors = ButtonDefaults.buttonColors(containerColor = ProfitSnapColors.CreditSale),
                modifier = Modifier.fillMaxWidth().height(52.dp),
            ) { Text("Save Credit Sale") }
            Spacer(Modifier.height(20.dp))
        }
    }
}
