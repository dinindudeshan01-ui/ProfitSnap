package lk.profitsnap.native_app.ui.screens.auth

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import lk.profitsnap.native_app.data.repository.AuthRepository
import lk.profitsnap.native_app.ui.theme.ProfitSnapColors

@Composable
fun LoginScreen(onSignedIn: () -> Unit) {
    val context = LocalContext.current
    val authRepository = remember { AuthRepository(context) }
    val scope = rememberCoroutineScope()

    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("ProfitSnap", style = MaterialTheme.typography.headlineMedium)
        Text("Sign in to your shop", style = MaterialTheme.typography.bodyMedium, color = ProfitSnapColors.Sub)

        Spacer(Modifier.height(24.dp))

        OutlinedTextField(
            value = email,
            onValueChange = { email = it },
            label = { Text("Email") },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(12.dp))
        OutlinedTextField(
            value = password,
            onValueChange = { password = it },
            label = { Text("Password") },
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
            modifier = Modifier.fillMaxWidth(),
        )

        error?.let {
            Spacer(Modifier.height(8.dp))
            Text(it, color = ProfitSnapColors.Danger, style = MaterialTheme.typography.bodySmall)
        }

        Spacer(Modifier.height(20.dp))

        Button(
            onClick = {
                loading = true
                error = null
                scope.launch {
                    val result = authRepository.signIn(email.trim(), password)
                    loading = false
                    result.onSuccess { onSignedIn() }
                        .onFailure { error = it.message ?: "Sign in failed" }
                }
            },
            enabled = !loading && email.isNotBlank() && password.isNotBlank(),
            colors = ButtonDefaults.buttonColors(containerColor = ProfitSnapColors.CreditSale),
            modifier = Modifier
                .fillMaxWidth()
                .height(52.dp),
        ) {
            Text(if (loading) "Signing in…" else "Sign In")
        }
    }
}
