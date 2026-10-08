package com.relay.receiver.ui

import android.Manifest
import android.app.Activity
import android.content.Context
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
import android.widget.ProgressBar
import android.widget.ScrollView
import android.widget.TextView
import com.google.zxing.BarcodeFormat
import com.google.zxing.qrcode.QRCodeWriter
import com.relay.receiver.R
import com.relay.receiver.core.SUPPORTED_LANGUAGES
import com.relay.receiver.core.chosenLanguage
import com.relay.receiver.core.localized
import com.relay.receiver.service.RelayForegroundService
import com.relay.receiver.shizuku.ShizukuBridge
import com.relay.receiver.transport.MqttTransport
import com.relay.receiver.update.UpdateState
import com.relay.receiver.update.Updater
import com.relay.receiver.update.releaseSummary
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
    private lateinit var updateVersion: TextView
    private lateinit var updateMessage: TextView
    private lateinit var updateNotes: TextView
    private lateinit var updateProgress: ProgressBar
    private lateinit var updateCheck: Button
    private lateinit var updateInstall: Button
    private lateinit var updatePage: Button
    private val updater by lazy { Updater.get(this) }
    private val toggles = mutableMapOf<String, CheckBox>()

    private val prefs by lazy { getSharedPreferences(RelayForegroundService.PREFS, MODE_PRIVATE) }

    override fun attachBaseContext(newBase: Context) {
        super.attachBaseContext(newBase.localized())
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = BG

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(28), dp(20), dp(40))
            setBackgroundColor(BG)
        }

        root.addView(text("Relay", 30f, FG, bold = true))
        root.addView(text(getString(R.string.subtitle), 14f, MUTED).apply {
            setPadding(0, 0, 0, dp(16))
        })
        root.addView(languageRow())

        statusView = text("", 15f, FG).apply { setLineSpacing(0f, 1.3f) }
        root.addView(card(statusView))

        // ------------------------------------------------------------ updates
        root.addView(header(getString(R.string.update_header)))
        updateVersion = text(getString(R.string.update_current, updater.installedVersion()), 14f, FG)
        updateMessage = text("", 14f, FG).apply { visibility = View.GONE; setPadding(0, dp(8), 0, 0) }
        updateNotes = text("", 13f, MUTED).apply { visibility = View.GONE; setPadding(0, dp(4), 0, 0) }
        updateProgress = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply {
            max = 100
            visibility = View.GONE
        }
        updateCheck = button(getString(R.string.update_btn_check), secondary = true) { updater.check() }
        updateInstall = button(getString(R.string.update_btn_install)) { updater.startUpdate(this@MainActivity) }
        updatePage = button(getString(R.string.update_btn_release_page), secondary = true) { }
        root.addView(card(updateVersion, updateMessage, updateNotes, updateProgress, updateInstall, updatePage, updateCheck))

        // ------------------------------------------------------------ pairing
        root.addView(header(getString(R.string.header_pairing)))
        pairInput = input(getString(R.string.hint_pair_code), prefs.getString(RelayForegroundService.KEY_PAIR_CODE, ""))
        relayInput = input(getString(R.string.hint_relay_url), prefs.getString(RelayForegroundService.KEY_RELAY_URL, ""))
        mqttInput = input(MqttTransport.DEFAULT_URL, prefs.getString(RelayForegroundService.KEY_MQTT_URL, ""))
        qrView = ImageView(this).apply {
            adjustViewBounds = true
            setPadding(dp(12), dp(12), dp(12), dp(12))
            background = rounded(Color.WHITE, 16)
        }
        root.addView(
            card(
                label(getString(R.string.label_code)), pairInput,
                button(getString(R.string.btn_generate_code), secondary = true) { pairInput.setText(generatePairCode()) },
                label(getString(R.string.label_relay_server)), relayInput,
                label(getString(R.string.label_mqtt_broker)), mqttInput,
                label(getString(R.string.label_scan_qr)), qrView,
            ),
        )

        // ------------------------------------------------------------ paths
        root.addView(header(getString(R.string.header_paths)))
        val disabled = prefs.getString(RelayForegroundService.KEY_DISABLED, "").orEmpty().split(",").toSet()
        val paths = listOf(
            "lan" to getString(R.string.path_lan),
            "webrtc" to getString(R.string.path_webrtc),
            "relay" to getString(R.string.path_relay),
            "http" to getString(R.string.path_http),
            "mqtt" to getString(R.string.path_mqtt),
            "ble" to getString(R.string.path_ble),
        )
        val boxes = paths.map { (id, name) ->
            CheckBox(this).apply {
                text = name
                setTextColor(FG)
                isChecked = id !in disabled
                toggles[id] = this
            }
        }
        root.addView(card(*boxes.toTypedArray()))

        root.addView(button(getString(R.string.btn_save_restart)) { save() })

        // ------------------------------------------------------------ grants
        root.addView(header(getString(R.string.header_permissions)))
        shizukuButton = button(getString(R.string.btn_shizuku), secondary = true) {
            if (ShizukuBridge.running()) ShizukuBridge.requestPermission()
            else openUrl("https://shizuku.rikka.app/guide/setup/")
        }
        root.addView(
            card(
                button(getString(R.string.perm_notifications), secondary = true) {
                    startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
                },
                button(getString(R.string.perm_accessibility), secondary = true) {
                    startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
                },
                button(getString(R.string.perm_bluetooth), secondary = true) { requestRuntimePermissions() },
                button(getString(R.string.perm_write_settings), secondary = true) {
                    startActivity(Intent(Settings.ACTION_MANAGE_WRITE_SETTINGS, Uri.parse("package:$packageName")))
                },
                button(getString(R.string.perm_battery), secondary = true) {
                    startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
                },
                button(getString(R.string.perm_autostart), secondary = true) {
                    startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName")))
                },
                shizukuButton,
                text(
                    getString(R.string.shizuku_note),
                    12f,
                    MUTED,
                ),
            ),
        )

        setContentView(ScrollView(this).apply {
            setBackgroundColor(BG)
            addView(root)
        })

        // One quiet look at GitHub per 12 hours; it never downloads or installs anything.
        if (updater.silentCheckDue()) updater.check(silent = true)
    }

    override fun onStart() {
        super.onStart()
        updater.listener = ::renderUpdate
        renderUpdate(updater.state)
    }

    override fun onStop() {
        updater.listener = null
        super.onStop()
    }

    private fun renderUpdate(s: UpdateState) {
        val release = when (s) {
            is UpdateState.Available -> s.release
            is UpdateState.NeedsPermission -> s.release
            is UpdateState.Downloading -> s.release
            is UpdateState.ReadyToInstall -> s.release
            is UpdateState.Installing -> s.release
            is UpdateState.Failed -> s.release
            else -> null
        }
        val message = when (s) {
            is UpdateState.Checking -> getString(R.string.update_checking)
            is UpdateState.UpToDate -> getString(R.string.update_up_to_date)
            is UpdateState.Available -> getString(R.string.update_available, s.release.version)
            is UpdateState.NeedsPermission -> getString(R.string.update_needs_permission)
            is UpdateState.Downloading ->
                if (s.total > 0) getString(R.string.update_downloading, (s.done * 100 / s.total).toInt())
                else getString(R.string.update_downloading_unknown)
            is UpdateState.ReadyToInstall -> getString(R.string.update_ready)
            is UpdateState.Installing -> getString(R.string.update_installing)
            is UpdateState.Failed -> s.message
            else -> ""
        }
        updateMessage.text = message
        updateMessage.visibility = if (message.isEmpty()) View.GONE else View.VISIBLE

        val lines = if (release != null && s !is UpdateState.Failed) {
            releaseSummary(release.notes).map { "• $it" } +
                listOfNotNull(if (release.important) getString(R.string.update_important) else null)
        } else emptyList()
        updateNotes.text = lines.joinToString("\n")
        updateNotes.visibility = if (lines.isEmpty()) View.GONE else View.VISIBLE

        val downloading = s is UpdateState.Downloading
        updateProgress.visibility = if (downloading) View.VISIBLE else View.GONE
        if (s is UpdateState.Downloading) {
            updateProgress.isIndeterminate = s.total <= 0
            if (s.total > 0) updateProgress.progress = (s.done * 100 / s.total).toInt()
        }

        val canInstall = s is UpdateState.Available || s is UpdateState.NeedsPermission ||
            s is UpdateState.Installing || (s is UpdateState.Failed && release != null)
        updateInstall.visibility = if (canInstall) View.VISIBLE else View.GONE
        updateInstall.text = getString(if (s is UpdateState.Failed) R.string.update_btn_retry else R.string.update_btn_install)

        updatePage.visibility = if (release != null) View.VISIBLE else View.GONE
        release?.let { r -> updatePage.setOnClickListener { openUrl(r.pageUrl) } }

        val busy = s is UpdateState.Checking || downloading
        updateCheck.isEnabled = !busy
        updateCheck.alpha = if (busy) 0.5f else 1f
    }

    override fun onResume() {
        super.onResume()
        // The one place a foreground service start is always permitted, so it
        // is where the relay comes back after the system killed it.
        RelayForegroundService.ensureRunning(this)
        refresh()
        // Back from the "install unknown apps" screen: carry on with the update that asked for it.
        updater.resumeAfterPermission(this)
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
            appendLine("$ok ${getString(if (notifications) R.string.status_seek_ready else R.string.status_seek_missing)}")
            appendLine("$ok ${getString(if (accessibility) R.string.status_fullscreen_ready else R.string.status_fullscreen_missing)}")
            appendLine("$ok ${getString(if (Settings.System.canWrite(this@MainActivity)) R.string.status_rotation_ready else R.string.status_rotation_missing)}")
            append("$ok ${ShizukuBridge.state(this@MainActivity)}")
        }
        shizukuButton.text = when {
            ShizukuBridge.granted() -> getString(R.string.shizuku_btn_ready)
            ShizukuBridge.running() -> getString(R.string.shizuku_btn_grant)
            else -> getString(R.string.shizuku_btn_howto)
        }
        renderQr()
    }

    /**
     * The pairing link as a QR code. It is an https landing page, not relay://… directly:
     * camera apps show unknown schemes as plain text. The page opens relay://pair?…
     */
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
        val link = "https://sandoramix.github.io/slop-remote-relay/pair/#" + params.joinToString("&") { (k, v) -> "$k=${URLEncoder.encode(v, "UTF-8")}" }
        val size = dp(220)
        val matrix = QRCodeWriter().encode(link, BarcodeFormat.QR_CODE, size, size)
        val bmp = Bitmap.createBitmap(size, size, Bitmap.Config.RGB_565)
        for (x in 0 until size) for (y in 0 until size) {
            bmp.setPixel(x, y, if (matrix[x, y]) Color.BLACK else Color.WHITE)
        }
        qrView.setImageBitmap(bmp)
        qrView.visibility = View.VISIBLE
    }

    /** "Language" label with one button per language, each named in its own language. */
    private fun languageRow() = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        setPadding(0, 0, 0, dp(8))
        addView(text(getString(R.string.language_label), 13f, MUTED).apply { setPadding(0, 0, dp(12), 0) })
        val current = chosenLanguage()
        SUPPORTED_LANGUAGES.forEach { code ->
            val selected = code == current
            addView(Button(this@MainActivity).apply {
                text = getString(if (code == "it") R.string.language_it else R.string.language_en)
                isAllCaps = false
                textSize = 13f
                minHeight = 0
                minimumHeight = 0
                setTextColor(if (selected) PRIMARY_INK else FG)
                background = rounded(if (selected) PRIMARY else SECONDARY, 14)
                setPadding(dp(14), dp(8), dp(14), dp(8))
                layoutParams = LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.WRAP_CONTENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT,
                ).apply { marginEnd = dp(8) }
                setOnClickListener { if (!selected) setLanguage(code) }
            })
        }
    }

    private fun setLanguage(code: String) {
        prefs.edit().putString(RelayForegroundService.KEY_LANGUAGE, code).apply()
        // The service resolves strings per call, but its notification only
        // refreshes on the next status tick; restart it so the new language shows now.
        stopService(Intent(this, RelayForegroundService::class.java))
        RelayForegroundService.ensureRunning(this)
        recreate()
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
