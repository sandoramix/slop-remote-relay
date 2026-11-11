plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "dev.sandoramix.skipper.screen"
    compileSdk = 36

    defaultConfig {
        applicationId = "dev.sandoramix.skipper.screen"
        minSdk = 26          // MediaSession + dispatchGesture both need 24; 26 for channels
        targetSdk = 36       // Google Play requires 36 for new apps and updates (since 2026-08-31)
        versionCode = 1
        versionName = "0.9.1"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    // Two distributions of the same code. `github` is the sideloaded APK with
    // its own GitHub-release updater; `play` is the Play Store bundle, which
    // Google updates itself: no REQUEST_INSTALL_PACKAGES, no updater UI, no
    // REQUEST_IGNORE_BATTERY_OPTIMIZATIONS (the settings screen the app opens
    // needs no permission). See src/play/AndroidManifest.xml.
    flavorDimensions += "dist"
    productFlavors {
        create("github") {
            dimension = "dist"
            buildConfigField("boolean", "GITHUB_UPDATES", "true")
        }
        create("play") {
            dimension = "dist"
            buildConfigField("boolean", "GITHUB_UPDATES", "false")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }

    // ShellService talks to the app over AIDL across the Shizuku process boundary.
    buildFeatures {
        aidl = true
        buildConfig = true
    }

    defaultConfig {
        // CI passes the tag (v1.2.3) through; local builds keep the default.
        (project.findProperty("relayVersion") as String?)?.let { v ->
            versionName = v.removePrefix("v")
            versionCode = v.removePrefix("v").split(".").let { (ma, mi, pa) ->
                ma.toInt() * 10_000 + mi.toInt() * 100 + pa.toInt()
            }
        }
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    // LAN WebSocket server
    implementation("org.java-websocket:Java-WebSocket:1.5.7")
    // Relay WebSocket client
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    // WebRTC DataChannel (prebuilt libwebrtc)
    implementation("io.getstream:stream-webrtc-android:1.3.10")
    // Optional shell-privileged executor
    implementation("dev.rikka.shizuku:api:13.1.5")
    implementation("dev.rikka.shizuku:provider:13.1.5")
    // QR code for pairing the controller
    implementation("com.google.zxing:core:3.5.4")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
}
