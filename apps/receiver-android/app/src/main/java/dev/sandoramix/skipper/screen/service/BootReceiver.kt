package dev.sandoramix.skipper.screen.service

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Brings the relay back after a reboot or an app update.
 *
 * BOOT_COMPLETED comes with an exemption from the background foreground-service
 * restriction; MY_PACKAGE_REPLACED does not, so that one may be refused and the
 * relay waits for the user to open the app. ensureRunning covers both.
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            Intent.ACTION_BOOT_COMPLETED,
            Intent.ACTION_MY_PACKAGE_REPLACED -> RelayForegroundService.ensureRunning(context)
        }
    }
}
