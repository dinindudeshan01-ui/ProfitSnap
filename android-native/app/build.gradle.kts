import java.util.Properties
import java.io.FileInputStream

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("com.google.devtools.ksp")
}

// Pull SUPABASE_URL / SUPABASE_ANON_KEY from gradle.properties (or a local
// local.properties override, which is already gitignored) into BuildConfig
// fields so nothing sensitive is hardcoded in source.
val localProps = Properties().apply {
    val f = rootProject.file("local.properties")
    if (f.exists()) load(FileInputStream(f))
}
fun cfg(key: String): String =
    (localProps.getProperty(key) ?: project.findProperty(key) as String? ?: "").let { "\"$it\"" }

android {
    namespace = "lk.profitsnap.native_app"
    compileSdk = 35

    defaultConfig {
        applicationId = "lk.profitsnap.native"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"

        buildConfigField("String", "SUPABASE_URL", cfg("SUPABASE_URL"))
        buildConfigField("String", "SUPABASE_ANON_KEY", cfg("SUPABASE_ANON_KEY"))
        buildConfigField("String", "APP_BASE_URL", cfg("APP_BASE_URL"))

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    composeOptions {
        kotlinCompilerExtensionVersion = "1.5.14"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }

    packaging {
        resources.excludes.add("/META-INF/{AL2.0,LGPL2.1}")
    }
}

dependencies {
    // Core / Compose
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.6")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.6")
    implementation("androidx.activity:activity-compose:1.9.2")
    implementation(platform("androidx.compose:compose-bom:2024.09.03"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-graphics")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.navigation:navigation-compose:2.8.1")

    // Room (local-first source of truth)
    implementation("androidx.room:room-runtime:2.6.1")
    implementation("androidx.room:room-ktx:2.6.1")
    ksp("androidx.room:room-compiler:2.6.1")

    // WorkManager (background sync)
    implementation("androidx.work:work-runtime-ktx:2.9.1")

    // Networking — talks to Supabase's PostgREST + GoTrue REST endpoints
    // directly, so there's no dependency on the (heavier, less stable)
    // supabase-kt SDK. Keeps the surface area small and easy to reason about.
    implementation("com.squareup.retrofit2:retrofit:2.11.0")
    implementation("com.squareup.retrofit2:converter-gson:2.11.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("com.squareup.okhttp3:logging-interceptor:4.12.0")

    // DataStore for the persisted auth session (access/refresh token)
    implementation("androidx.datastore:datastore-preferences:1.1.1")

    // CameraX + ML Kit not pulled in yet — the scan/OCR flow reuses the
    // existing server-side /api/scan Gemini route (see SyncPlan.md), so a
    // native camera capture screen is enough; no on-device OCR dependency.
    implementation("androidx.camera:camera-camera2:1.3.4")
    implementation("androidx.camera:camera-lifecycle:1.3.4")
    implementation("androidx.camera:camera-view:1.3.4")

    implementation("androidx.compose.material:material-icons-extended:1.7.3")

    // Google Play Billing — subscriptions for ProfitSnap Pro. Dialog
    // carrier billing appears automatically as a payment option inside
    // this checkout flow (it's a Play Store payment method, not a
    // separate integration) — no Dialog-specific code needed here.
    implementation("com.android.billingclient:billing-ktx:7.1.1")

    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.6.1")
}
