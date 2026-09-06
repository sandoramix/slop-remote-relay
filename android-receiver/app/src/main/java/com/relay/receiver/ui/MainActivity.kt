package com.relay.receiver.ui

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import android.text.TextUtils
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import com.relay.receiver.service.RelayForegroundService

/**
 * Onboarding, and nothing else. Its only job is walking the user through the
 * grants the relay needs, because every one of them lives in a different corner
 * of system settings and none can be requested with a normal permission dialog.
 *
 * Built with plain views on purpose: this screen is opened roughly twice in the
 * lifetime of an install, and it must work on the oldest device in the house.
 */
class MainActivity : Activity() {

    private lateinit var statusView: TextView
    private lateinit var pairInput: EditText
    private lateinit var relayInput: EditText

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val prefs = getSharedPreferences(RelayForegroundService.PREFS, MODE_PRIVATE)

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(48, 64, 48, 48)
        }

        statusView = TextView(this)
        pairInput = EditText(this).apply {
            hint = "Codice di accoppiamento"
            setText(prefs.getString(RelayForegroundService.KEY_PAIR_CODE, ""))
        }
        relayInput = EditText(this).apply {
            hint = "wss://relay.example.com (opzionale)"
            setText(prefs.getString(RelayForegroundService.KEY_RELAY_URL, ""))
        }

        root.addView(statusView)
        root.addView(pairInput)
        root.addView(relayInput)

        root.addView(button("Salva e riavvia il relay") {
            prefs.edit()
                .putString(RelayForegroundService.KEY_PAIR_CODE, pairInput.text.toString().trim())
                .putString(RelayForegroundService.KEY_RELAY_URL, relayInput.text.toString().trim())
                .apply()
            stopService(Intent(this, RelayForegroundService::class.java))
            RelayForegroundService.ensureRunning(this)
            refreshStatus()
        })

        root.addView(button("1. Accesso alle notifiche (serve per il seek)") {
            startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
        })
        root.addView(button("2. Accessibilità (serve per lo schermo intero)") {
            startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
        })
        root.addView(button("3. Modifica impostazioni di sistema (rotazione)") {
            startActivity(
                Intent(Settings.ACTION_MANAGE_WRITE_SETTINGS, Uri.parse("package:$packageName")),
            )
        })
        root.addView(button("4. Escludi dall'ottimizzazione batteria") {
            startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
        })
        root.addView(button("5. Autostart del produttore (Xiaomi, Oppo, Samsung…)") {
            startActivity(
                Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName")),
            )
        })

        setContentView(root)
    }

    override fun onResume() {
        super.onResume()
        // This is the one place a foreground service start is always permitted,
        // so it is where the relay is brought back after the system has killed
        // it or refused an earlier start from the background.
        RelayForegroundService.ensureRunning(this)
        refreshStatus()
    }

    private fun refreshStatus() {
        val notifications = isNotificationListenerEnabled()
        val accessibility = isAccessibilityEnabled()
        statusView.text = buildString {
            appendLine("Seek: ${if (notifications) "pronto" else "manca l'accesso alle notifiche"}")
            appendLine("Schermo intero: ${if (accessibility) "pronto" else "manca l'accessibilità"}")
            appendLine("Rotazione: ${if (Settings.System.canWrite(this@MainActivity)) "pronta" else "non concessa"}")
        }
    }

    private fun isNotificationListenerEnabled(): Boolean {
        val flat = Settings.Secure.getString(contentResolver, "enabled_notification_listeners")
        return flat?.contains(packageName) == true
    }

    private fun isAccessibilityEnabled(): Boolean {
        val enabled = Settings.Secure.getString(
            contentResolver,
            Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES,
        ) ?: return false
        val splitter = TextUtils.SimpleStringSplitter(':')
        splitter.setString(enabled)
        return splitter.any { it.startsWith(packageName) }
    }

    private fun button(label: String, onClick: () -> Unit) = Button(this).apply {
        text = label
        setOnClickListener { onClick() }
    }
}
