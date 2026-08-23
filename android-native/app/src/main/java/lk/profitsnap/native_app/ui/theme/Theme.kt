package lk.profitsnap.native_app.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

// Mirrors src/lib/theme.ts in the web app so the native app doesn't look
// like a different product — same accent colors per feature area.
object ProfitSnapColors {
    val Sales = Color(0xFFFF6B35)
    val Stock = Color(0xFF0EA5E9)
    val Profit = Color(0xFF8B5CF6)
    val Products = Color(0xFF10B981)
    val CreditSale = Color(0xFF0D9488)
    val Credits = Color(0xFFD4A017)
    val Danger = Color(0xFFEF4444)
    val Background = Color(0xFFF2F4F8)
    val Foreground = Color(0xFF1A1D23)
    val Sub = Color(0xFF6B7280)
}

private val lightScheme = lightColorScheme(
    primary = ProfitSnapColors.CreditSale,
    background = ProfitSnapColors.Background,
    surface = Color.White,
    onBackground = ProfitSnapColors.Foreground,
    onSurface = ProfitSnapColors.Foreground,
)

@Composable
fun ProfitSnapTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = lightScheme,
        content = content,
    )
}
