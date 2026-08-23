package lk.profitsnap.native_app.ui.nav

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import lk.profitsnap.native_app.data.repository.AuthRepository
import lk.profitsnap.native_app.ui.screens.auth.LoginScreen
import lk.profitsnap.native_app.ui.screens.home.HomeScreen

/**
 * v1 nav graph: auth gate + Home wired to live Room data. Sales / Stock /
 * Profit / Items / Credit routes are stubbed as placeholders so the app
 * runs and demonstrates the full offline-first plumbing end to end
 * (auth → Room → sync) — fill each in following the same repository
 * pattern as ProductRepository/SaleRepository.
 */
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
        composable("sales") { PlaceholderScreen("Record Sales") }
        composable("stock") { PlaceholderScreen("Stock In") }
        composable("profit") { PlaceholderScreen("My Profit") }
        composable("items") { PlaceholderScreen("My Items") }
        composable("credit") { PlaceholderScreen("Credit Sales") }
    }
}

@Composable
private fun PlaceholderScreen(title: String) {
    Box(Modifier.fillMaxSize().padding(24.dp)) {
        Text("$title — build this next, following ProductRepository/SaleRepository's pattern.")
    }
}
