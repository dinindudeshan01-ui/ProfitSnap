package lk.profitsnap.native_app.ui.screens.scan

import android.Manifest
import android.content.pm.PackageManager
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Circle
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import kotlinx.coroutines.launch
import lk.profitsnap.native_app.data.remote.SessionStore
import lk.profitsnap.native_app.data.repository.ScanOutcome
import lk.profitsnap.native_app.data.repository.ScanRepository
import lk.profitsnap.native_app.ui.theme.ProfitSnapColors
import java.io.File

private val guideTextFor = mapOf(
    "setup" to "Write: Code  Name  Qty  Cost  Sell  (one item per line)",
    "stock_in" to "Write: Code  Name  Qty  Cost  Sell  (one item per line)",
    "sales" to "Write: Code  Name  Qty  (one item per line)",
    "credit_sale" to "Write: Customer Name  Phone  What they bought  Amount",
)

@Composable
fun ScanScreen(scanType: String, onBack: () -> Unit, onDone: () -> Unit) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val scope = rememberCoroutineScope()

    var hasCameraPermission by remember {
        mutableStateOf(
            ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
        )
    }
    val permissionLauncher = androidx.activity.compose.rememberLauncherForActivityResult(
        androidx.activity.result.contract.ActivityResultContracts.RequestPermission()
    ) { granted -> hasCameraPermission = granted }

    LaunchedEffect(Unit) {
        if (!hasCameraPermission) permissionLauncher.launch(Manifest.permission.CAMERA)
    }

    var imageCapture by remember { mutableStateOf<ImageCapture?>(null) }
    var uiState by remember { mutableStateOf<UiState>(UiState.Idle) }

    Box(Modifier.fillMaxSize().background(Color.Black)) {
        if (hasCameraPermission) {
            AndroidView(
                modifier = Modifier.fillMaxSize(),
                factory = { ctx ->
                    val previewView = PreviewView(ctx)
                    val cameraProviderFuture = ProcessCameraProvider.getInstance(ctx)
                    cameraProviderFuture.addListener({
                        val cameraProvider = cameraProviderFuture.get()
                        val preview = Preview.Builder().build().also {
                            it.setSurfaceProvider(previewView.surfaceProvider)
                        }
                        val capture = ImageCapture.Builder().build()
                        imageCapture = capture
                        try {
                            cameraProvider.unbindAll()
                            cameraProvider.bindToLifecycle(
                                lifecycleOwner, CameraSelector.DEFAULT_BACK_CAMERA, preview, capture,
                            )
                        } catch (_: Exception) { /* camera bind failed — preview just stays blank, capture button will no-op */ }
                    }, ContextCompat.getMainExecutor(ctx))
                    previewView
                },
            )
        } else {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text("Camera permission needed to scan", color = Color.White)
            }
        }

        // Header
        Row(
            Modifier.fillMaxWidth().background(Color.Black.copy(alpha = 0.55f)).padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = onBack) {
                Icon(Icons.Default.ArrowBack, contentDescription = "Back", tint = Color.White)
            }
            Spacer(Modifier.width(4.dp))
            Text("Scan sheet", color = Color.White, style = MaterialTheme.typography.titleMedium)
        }

        // Guide text
        Box(
            Modifier.align(Alignment.BottomCenter).fillMaxWidth().padding(bottom = 120.dp).padding(horizontal = 24.dp)
                .background(Color.Black.copy(alpha = 0.55f), MaterialTheme.shapes.medium).padding(12.dp),
        ) {
            Text(
                guideTextFor[scanType] ?: "",
                color = Color.White,
                style = MaterialTheme.typography.bodySmall,
                textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                modifier = Modifier.fillMaxWidth(),
            )
        }

        // Shutter button
        Box(Modifier.align(Alignment.BottomCenter).padding(bottom = 32.dp)) {
            when (val state = uiState) {
                is UiState.Loading -> CircularProgressIndicator(color = ProfitSnapColors.CreditSale)
                else -> IconButton(
                    onClick = {
                        val capture = imageCapture ?: return@IconButton
                        uiState = UiState.Loading
                        val photoFile = File(context.cacheDir, "scan_${System.currentTimeMillis()}.jpg")
                        val outputOptions = ImageCapture.OutputFileOptions.Builder(photoFile).build()
                        capture.takePicture(
                            outputOptions,
                            ContextCompat.getMainExecutor(context),
                            object : ImageCapture.OnImageSavedCallback {
                                override fun onImageSaved(output: ImageCapture.OutputFileResults) {
                                    scope.launch {
                                        val sessionStore = SessionStore(context)
                                        val tenantId = sessionStore.currentUserId() ?: run {
                                            uiState = UiState.Error("Not signed in")
                                            return@launch
                                        }
                                        val repo = ScanRepository(context, tenantId)
                                        when (val outcome = repo.scanAndApply(photoFile, scanType)) {
                                            is ScanOutcome.Success -> {
                                                uiState = UiState.Idle
                                                onDone()
                                            }
                                            is ScanOutcome.Failed -> {
                                                uiState = UiState.Error(outcome.message)
                                            }
                                        }
                                    }
                                }
                                override fun onError(exception: ImageCaptureException) {
                                    uiState = UiState.Error(exception.message ?: "Capture failed")
                                }
                            },
                        )
                    },
                    modifier = Modifier
                        .size(72.dp)
                        .background(Color.White, shape = androidx.compose.foundation.shape.CircleShape),
                ) {
                    Icon(Icons.Default.Circle, contentDescription = "Capture", tint = Color.White, modifier = Modifier.size(56.dp))
                }
            }
        }

        (uiState as? UiState.Error)?.let { error ->
            AlertDialog(
                onDismissRequest = { uiState = UiState.Idle },
                title = { Text("Hmm, not quite…") },
                text = { Text(error.message) },
                confirmButton = {
                    TextButton(onClick = { uiState = UiState.Idle }) { Text("Try again") }
                },
                dismissButton = {
                    TextButton(onClick = onBack) { Text("Cancel") }
                },
            )
        }
    }
}

private sealed class UiState {
    object Idle : UiState()
    object Loading : UiState()
    data class Error(val message: String) : UiState()
}
