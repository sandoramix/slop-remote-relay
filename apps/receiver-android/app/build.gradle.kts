plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.relay.receiver"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.relay.receiver"
        minSdk = 26          // MediaSession + dispatchGesture both need 24; 26 for channels
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }

    // ShellService talks to the app over AIDL across the Shizuku process boundary.
    buildFeatures { aidl = true }

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
