package dev.sandoramix.skipper.screen.ui

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.ConnectivityManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.text.TextUtils
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import com.google.zxing.BarcodeFormat
import com.google.zxing.qrcode.QRCodeWriter
import dev.sandoramix.skipper.screen.service.RelayForegroundService
import dev.sandoramix.skipper.screen.shizuku.ShizukuBridge
import dev.sandoramix.skipper.screen.transport.MqttTransport
import java.net.Inet4Address
import java.net.URLEncoder
import java.security.SecureRandom

/**
 * Pairing and onboarding. Its jobs: hold the pair code, show it as a QR the
 * controller can scan, and walk the user through the grants the relay needs,
 * each of which lives in a different corner of system settings.
 *
 * Plain views on purpose: this screen is opened a handful of times in the life
 * of an install, and it must work on the oldest device in the house.
 */
class MainActivity : Activity() {

    private lateinit var statusView: TextView
    private lateinit var pairInput: EditText
    private lateinit var relayInput: EditText
    private lateinit var mqttInput: EditText
    private lateinit var qrView: ImageView
    private lateinit var shizukuButton: Button
    private val toggles = mutableMapOf<String, CheckBox>()

    private val prefs by lazy { getSharedPreferences(RelayForegroundService.PREFS, MODE_PRIVATE) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = BG

        // Two columns once there is room (a tablet, or a phone in landscape
        // wide enough): pairing on the left, paths and permissions on the right.
        val wide = resources.configuration.screenWidthDp >= 600

        val title = text("Skipper Screen", 30f, FG, bold = true)
        val subtitle = text("Ricevitore — questo telefono viene comandato", 14f, MUTED).apply {
            setPadding(0, 0, 0, dp(16))
        }
        statusView = text("", 15f, FG).apply { setLineSpacing(0f, 1.3f) }

        // ------------------------------------------------------------ pairing
        pairInput = input("Codice di accoppiamento", prefs.getString(RelayForegroundService.KEY_PAIR_CODE, ""))
        relayInput = input("wss://relay.esempio.it (facoltativo)", prefs.getString(RelayForegroundService.KEY_RELAY_URL, ""))
        mqttInput = input(MqttTransport.DEFAULT_URL, prefs.getString(RelayForegroundService.KEY_MQTT_URL, ""))
        // Fixed size: stretched to the card's width it filled a landscape tablet.
        qrView = ImageView(this).apply {
            adjustViewBounds = true
            setPadding(dp(12), dp(12), dp(12), dp(12))
            background = rounded(Color.WHITE, 16)
            layoutParams = LinearLayout.LayoutParams(dp(QR_DP), dp(QR_DP)).apply {
                gravity = Gravity.CENTER_HORIZONTAL
                topMargin = dp(4)
            }
        }
        val fields = listOf(
            label("Codice"), pairInput,
            button("Genera un codice nuovo", secondary = true) { pairInput.setText(generatePairCode()) },
            label("Server relay"), relayInput,
            label("Broker MQTT"), mqttInput,
        )
        val qrBlock = column(label("Inquadra dal controller per associarlo"), qrView)
        val pairingCard = if (wide) {
            // QR beside the fields, so the pairing card stays short.
            card(
                LinearLayout(this).apply {
                    orientation = LinearLayout.HORIZONTAL
                    addView(column(*fields.toTypedArray()), LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
                    addView(qrBlock, LinearLayout.LayoutParams(
                        LinearLayout.LayoutParams.WRAP_CONTENT,
                        LinearLayout.LayoutParams.WRAP_CONTENT,
                    ).apply { marginStart = dp(16) })
                },
            )
        } else {
            card(*(fields + qrBlock).toTypedArray())
        }

        // ------------------------------------------------------------ paths
        val disabled = prefs.getString(RelayForegroundService.KEY_DISABLED, "").orEmpty().split(",").toSet()
        val paths = listOf(
            "lan" to "Wi-Fi locale",
            "webrtc" to "WebRTC P2P (serve il relay)",
            "relay" to "Relay WebSocket",
            "http" to "Relay HTTP",
            "mqtt" to "MQTT",
            "ble" to "Bluetooth",
        )
        val boxes = paths.map { (id, name) ->
            CheckBox(this).apply {
                text = name
                setTextColor(FG)
                isChecked = id !in disabled
                toggles[id] = this
            }
        }

        // ------------------------------------------------------------ grants
        shizukuButton = button("Shizuku", secondary = true) {
            if (ShizukuBridge.running()) ShizukuBridge.requestPermission()
            else openUrl("https://shizuku.rikka.app/guide/setup/")
        }
        val grants = card(
            button("1. Accesso alle notifiche — salti esatti", secondary = true) {
                startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
            },
            button("2. Accessibilità — schermo intero", secondary = true) {
                startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
            },
            button("3. Bluetooth e notifiche", secondary = true) { requestRuntimePermissions() },
            button("4. Modifica impostazioni — rotazione", secondary = true) {
                startActivity(Intent(Settings.ACTION_MANAGE_WRITE_SETTINGS, Uri.parse("package:$packageName")))
            },
            button("5. Escludi dall'ottimizzazione batteria", secondary = true) {
                startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
            },
            button("6. Autostart del produttore (Xiaomi, Oppo, Samsung…)", secondary = true) {
                startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName")))
            },
            shizukuButton,
            text(
                "Shizuku è facoltativo: sblocca tasti e tocchi anche senza accessibilità, " +
                    "ma va riavviato dopo ogni riavvio del telefono.",
                12f,
                MUTED,
            ),
        )

        val left = listOf(title, subtitle, card(statusView), header("Accoppiamento"), pairingCard)
        val right = listOf(
            header("Percorsi attivi"), card(*boxes.toTypedArray()),
            button("Salva e riavvia") { save() },
            header("Permessi"), grants,
        )
        val root = if (wide) {
            LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                val weight = { LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f) }
                addView(column(*left.toTypedArray()), weight())
                addView(column(*right.toTypedArray()), weight().apply { marginStart = dp(24) })
            }
        } else {
            column(*(left + right).toTypedArray())
        }.apply {
            setPadding(dp(20), dp(28), dp(20), dp(40))
            setBackgroundColor(BG)
        }

        setContentView(ScrollView(this).apply {
            setBackgroundColor(BG)
            addView(root)
        })
    }

    override fun onResume() {
        super.onResume()
        // The one place a foreground service start is always permitted, so it
        // is where the relay comes back after the system killed it.
        RelayForegroundService.ensureRunning(this)
        refresh()
    }

    private fun save() {
        val off = toggles.filterValues { !it.isChecked }.keys.joinToString(",")
        prefs.edit()
            .putString(RelayForegroundService.KEY_PAIR_CODE, pairInput.text.toString().trim())
            .putString(RelayForegroundService.KEY_RELAY_URL, relayInput.text.toString().trim())
            .putString(RelayForegroundService.KEY_MQTT_URL, mqttInput.text.toString().trim())
            .putString(RelayForegroundService.KEY_DISABLED, off)
            .apply()
        stopService(Intent(this, RelayForegroundService::class.java))
        RelayForegroundService.ensureRunning(this)
        refresh()
    }

    private fun refresh() {
        val notifications = isNotificationListenerEnabled()
        val accessibility = isAccessibilityEnabled()
        val ok = "●"
        statusView.text = buildString {
            appendLine("$ok Salti esatti: ${if (notifications) "pronti" else "manca l'accesso alle notifiche"}")
            appendLine("$ok Schermo intero: ${if (accessibility) "pronto" else "manca l'accessibilità"}")
            appendLine("$ok Rotazione: ${if (Settings.System.canWrite(this@MainActivity)) "pronta" else "non concessa"}")
            append("$ok ${ShizukuBridge.state(this@MainActivity)}")
        }
        shizukuButton.text = when {
            ShizukuBridge.granted() -> "Shizuku: pronto"
            ShizukuBridge.running() -> "Shizuku: concedi il permesso"
            else -> "Shizuku: come si attiva"
        }
        renderQr()
    }

    /** relay://pair?… — the controller's pairing deep link, as a QR code. */
    private fun renderQr() {
        val code = prefs.getString(RelayForegroundService.KEY_PAIR_CODE, null)
        if (code.isNullOrBlank()) {
            qrView.visibility = View.GONE
            return
        }
        val params = buildList {
            add("code" to code)
            add("name" to Build.MODEL)
            add("kind" to "android")
            prefs.getString(RelayForegroundService.KEY_RELAY_URL, null)?.takeIf { it.isNotBlank() }?.let { add("relay" to it) }
            lanAddress()?.let { add("lan" to it) }
        }
        val link = "relay://pair?" + params.joinToString("&") { (k, v) -> "$k=${URLEncoder.encode(v, "UTF-8")}" }
        val size = dp(220)
        val matrix = QRCodeWriter().encode(link, BarcodeFormat.QR_CODE, size, size)
        val bmp = Bitmap.createBitmap(size, size, Bitmap.Config.RGB_565)
        for (x in 0 until size) for (y in 0 until size) {
            bmp.setPixel(x, y, if (matrix[x, y]) Color.BLACK else Color.WHITE)
        }
        qrView.setImageBitmap(bmp)
        qrView.visibility = View.VISIBLE
    }

    private fun lanAddress(): String? = runCatching {
        val cm = getSystemService(ConnectivityManager::class.java)
        cm.getLinkProperties(cm.activeNetwork)?.linkAddresses
            ?.map { it.address }
            ?.firstOrNull { it is Inet4Address && !it.isLoopbackAddress }
            ?.hostAddress
    }.getOrNull()

    private fun requestRuntimePermissions() {
        val wanted = buildList {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                add(Manifest.permission.BLUETOOTH_ADVERTISE)
                add(Manifest.permission.BLUETOOTH_CONNECT)
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) add(Manifest.permission.POST_NOTIFICATIONS)
        }.filter { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
        if (wanted.isNotEmpty()) requestPermissions(wanted.toTypedArray(), 1)
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, results: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, results)
        // BLE can only start once the grant exists; a restart picks it up.
        save()
    }

    private fun isNotificationListenerEnabled(): Boolean =
        Settings.Secure.getString(contentResolver, "enabled_notification_listeners")?.contains(packageName) == true

    private fun isAccessibilityEnabled(): Boolean {
        val enabled = Settings.Secure.getString(contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES)
            ?: return false
        val splitter = TextUtils.SimpleStringSplitter(':')
        splitter.setString(enabled)
        return splitter.any { it.startsWith(packageName) }
    }

    private fun openUrl(url: String) = startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))

    // ----------------------------------------------------------------- views

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    private fun rounded(color: Int, radiusDp: Int) = GradientDrawable().apply {
        setColor(color)
        cornerRadius = dp(radiusDp).toFloat()
    }

    private fun text(s: String, size: Float, color: Int, bold: Boolean = false) = TextView(this).apply {
        text = s
        textSize = size
        setTextColor(color)
        if (bold) typeface = Typeface.DEFAULT_BOLD
    }

    private fun header(s: String) = text(s.uppercase(), 12f, MUTED, bold = true).apply {
        letterSpacing = 0.12f
        setPadding(dp(4), dp(24), 0, dp(8))
    }

    private fun label(s: String) = text(s, 13f, MUTED).apply { setPadding(0, dp(10), 0, dp(4)) }

    private fun input(hint: String, value: String?) = EditText(this).apply {
        this.hint = hint
        setText(value.orEmpty())
        setTextColor(FG)
        setHintTextColor(MUTED)
        isSingleLine = true
        background = rounded(SECONDARY, 12)
        setPadding(dp(12), dp(10), dp(12), dp(10))
    }

    private fun column(vararg children: View) = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        children.forEach { addView(it) }
    }

    private fun card(vararg children: View) = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        background = rounded(CARD, 20)
        setPadding(dp(16), dp(14), dp(16), dp(16))
        children.forEach { addView(it) }
        layoutParams = LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT,
        )
    }

    private fun button(label: String, secondary: Boolean = false, onClick: () -> Unit) = Button(this).apply {
        text = label
        isAllCaps = false
        textSize = 15f
        gravity = if (secondary) Gravity.START or Gravity.CENTER_VERTICAL else Gravity.CENTER
        setTextColor(if (secondary) FG else PRIMARY_INK)
        background = rounded(if (secondary) SECONDARY else PRIMARY, 14)
        setPadding(dp(14), dp(12), dp(14), dp(12))
        layoutParams = LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT,
        ).apply { topMargin = dp(8) }
        setOnClickListener { onClick() }
    }

    companion object {
        /** The QR's side, in dp: big enough to scan from a phone, never the whole screen. */
        private const val QR_DP = 240

        // Same palette as the controller (apps/controller/global.css).
        private val BG = Color.rgb(20, 24, 30)
        private val CARD = Color.rgb(29, 35, 43)
        private val SECONDARY = Color.rgb(37, 44, 54)
        private val FG = Color.rgb(237, 233, 227)
        private val MUTED = Color.rgb(139, 149, 163)
        private val PRIMARY = Color.rgb(232, 176, 75)
        private val PRIMARY_INK = Color.rgb(27, 32, 39)

        private const val ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789"

        /** 80 bits in four groups of four; same scheme as generatePairCode in the controller. */
        fun generatePairCode(): String {
            val bytes = ByteArray(16).also { SecureRandom().nextBytes(it) }
            return bytes.mapIndexed { i, b ->
                val c = ALPHABET[(b.toInt() and 0xff) % 32]
                if (i % 4 == 3 && i < 15) "$c-" else "$c"
            }.joinToString("")
        }
    }
}
