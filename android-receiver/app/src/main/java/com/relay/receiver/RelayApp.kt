package com.relay.receiver

import android.app.Application
import android.content.Intent
import androidx.core.content.ContextCompat
import com.relay.receiver.service.RelayForegroundService

class RelayApp : Application() {
    override fun onCreate() {
        super.onCreate()
        ContextCompat.startForegroundService(
            this,
            Intent(this, RelayForegroundService::class.java),
        )
    }
}
