package lk.profitsnap.native_app.ui.nav

import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import lk.profitsnap.native_app.data.repository.AuthRepository
import lk.profitsnap.native_app.ui.screens.auth.LoginScreen
import lk.profitsnap.native_app.ui.screens.credit.CreditScreen
import lk.profitsnap.native_app.ui.screens.home.HomeScreen
import lk.profitsnap.native_app.ui.screens.items.ItemsScreen
import lk.profitsnap.native_app.ui.screens.profit.ProfitScreen
import lk.profitsnap.native_app.ui.screens.sales.SalesScreen
import lk.profitsnap.native_app.ui.screens.scan.ScanScreen
import lk.profitsnap.native_app.ui.screens.stock.StockScreen

@Composable
fun AppNavHost() {
    val context = LocalContext.current
    val authRepository = remember { AuthRepository(context) }
    val isSignedIn by authRepository.isSignedIn.collectAsState(initial = null)
    val navController = rememberNavController()

    when (isSignedIn) {
        null -> Unit // still loading the persisted session — show nothing briefly
        false -> LoginScreen(onSignedIn = { navController.navigate("home") { popUpTo(0) } })
        true -> MainNavHost(navController)
    }
}

@Composable
private fun MainNavHost(navController: NavHostController) {
    NavHost(navController = navController, startDestination = "home") {
        composable("home") {
            HomeScreen(onNavigate = { route -> navController.navigate(route) })
        }
        composable("sales") {
            SalesScreen(
                onBack = { navController.popBackStack() },
                onScan = { navController.navigate("scan/sales") },
            )
        }
        composable("stock") {
            StockScreen(
                onBack = { navController.popBackStack() },
                onScan = { navController.navigate("scan/stock_in") },
            )
        }
        composable("profit") {
            ProfitScreen(onBack = { navController.popBackStack() })
        }
        composable("items") {
            ItemsScreen(onBack = { navController.popBackStack() })
        }
        composable("credit") {
            CreditScreen(
                onBack = { navController.popBackStack() },
                onScan = { navController.navigate("scan/credit_sale") },
            )
        }
        composable(
            "scan/{scanType}",
            arguments = listOf(navArgument("scanType") { type = NavType.StringType }),
        ) { backStackEntry ->
            val scanType = backStackEntry.arguments?.getString("scanType") ?: "sales"
            ScanScreen(
                scanType = scanType,
                onBack = { navController.popBackStack() },
                onDone = { navController.popBackStack() },
            )
        }
    }
}
