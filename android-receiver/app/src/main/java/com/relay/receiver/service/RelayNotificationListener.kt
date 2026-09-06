package com.relay.receiver.service

import android.service.notification.NotificationListenerService

/**
 * Bound purely to unlock MediaSessionManager.getActiveSessions(), which requires
 * either this binding or a signature-level permission we cannot hold.
 *
 * It reads no notifications and overrides no callbacks. Worth saying plainly in
 * the onboarding screen, because the permission prompt sounds far more invasive
 * than what the app actually does with it.
 */
class RelayNotificationListener : NotificationListenerService() {

    override fun onListenerConnected() {
        super.onListenerConnected()
        isBound = true
    }

    override fun onListenerDisconnected() {
        isBound = false
        super.onListenerDisconnected()
    }

    companion object {
        @Volatile
        var isBound: Boolean = false
            private set
    }
}
