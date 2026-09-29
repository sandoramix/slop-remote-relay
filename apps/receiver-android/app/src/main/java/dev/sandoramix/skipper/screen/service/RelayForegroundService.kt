package dev.sandoramix.skipper.screen.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.content.ContextCompat
import dev.sandoramix.skipper.screen.R
import dev.sandoramix.skipper.screen.actions.AccessibilityExecutor
import dev.sandoramix.skipper.screen.actions.ExecutorChain
import dev.sandoramix.skipper.screen.actions.MediaSessionExecutor
import dev.sandoramix.skipper.screen.actions.ShizukuExecutor
import dev.sandoramix.skipper.screen.core.Codec
import dev.sandoramix.skipper.screen.core.CommandRouter
import dev.sandoramix.skipper.screen.recipes.RecipeEngine
import dev.sandoramix.skipper.screen.transport.BleGattTransport
import dev.sandoramix.skipper.screen.transport.LanServerTransport
import dev.sandoramix.skipper.screen.transport.MqttTransport
import dev.sandoramix.skipper.screen.transport.RelayClientTransport
import dev.sandoramix.skipper.screen.transport.RelayHttpTransport
import dev.sandoramix.skipper.screen.transport.WebRtcTransport
import dev.sandoramix.skipper.screen.transport.Transport
import dev.sandoramix.skipper.screen.transport.TransportSet
import dev.sandoramix.skipper.screen.ui.MainActivity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * The long-lived process. Owns the transport set, the executor chain, and the
 * router, and is the thing that has to survive for weeks without being touched.
 *
 * Three things keep it alive, and all three are needed:
 *   1. foreground service + persistent notification (survives Doze)
 *   2. battery optimisation exemption (survives standby buckets)
 *   3. the vendor's own autostart allowance (survives Xiaomi, Oppo, Samsung)
 * The onboarding screen walks the user through all three; skipping the third is
 * the usual reason a receiver goes quiet after a night on the charger.
 */
class RelayForegroundService : Service() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private var transports: TransportSet? = null
    private var router: CommandRouter? = null
    private var statusJob: Job? = null

    override fun onCreate() {
        super.onCreate()
        startForeground(NOTIFICATION_ID, buildNotification("Avvio…"))
        bootstrap()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // START_STICKY so the system restarts us if it reclaims the process.
        return START_STICKY
    }

    private fun bootstrap() {
        val prefs = getSharedPreferences(PREFS, MODE_PRIVATE)
        val pairCode = prefs.getString(KEY_PAIR_CODE, null)
        if (pairCode.isNullOrBlank()) {
            updateNotification("In attesa dell'accoppiamento")
            return
        }

        val secret = Codec.secretFromPairCode(pairCode)
        val room = Codec.roomFromPairCode(pairCode)
        val recipes = RecipeEngine(this)
        val mediaSession = MediaSessionExecutor(this)

        // Preference order: exact and invisible first, most demanding last.
        // Shizuku reports itself unavailable until it is running and granted,
        // so it costs nothing on a device that never sets it up.
        val accessibility = AccessibilityExecutor(this, recipes)
        val chain = ExecutorChain(
            listOf(
                mediaSession,
                accessibility,
                ShizukuExecutor(this, recipes) { accessibility.isFullscreen() },
            ),
        )

        val commandRouter = CommandRouter(this, secret, chain, mediaSession, recipes) {
            accessibility.isFullscreen()
        }
        router = commandRouter

        // Every path at once: the receiver is reachable on all of them and the
        // controller picks. The user can switch any of them off here, e.g. MQTT
        // for privacy on a public broker.
        val disabled = prefs.getString(KEY_DISABLED, "").orEmpty().split(",").toSet()
        val relayUrl = prefs.getString(KEY_RELAY_URL, null)?.takeIf { it.isNotBlank() }
        val mqttUrl = prefs.getString(KEY_MQTT_URL, null)?.takeIf { it.isNotBlank() }
            ?: MqttTransport.DEFAULT_URL
        val candidates = listOfNotNull(
            LanServerTransport(this, scope),
            relayUrl?.let { WebRtcTransport(this, it, room, secret, scope) },
            relayUrl?.let { RelayClientTransport(it, room, scope) },
            relayUrl?.let { RelayHttpTransport(it, room, scope) },
            MqttTransport(mqttUrl, room, scope),
            BleGattTransport(this, scope),
        )
        val list = candidates.filter { it.id !in disabled }

        val set = TransportSet(list)
        set.start { raw, transportId -> commandRouter.handle(raw, transportId) }
        transports = set

        startStatusLoop()
        Log.i(TAG, "relay up with ${list.size} transports")
    }

    /**
     * Pushes a status event whenever the picture changes, so the controller's
     * dashboard is current without polling hard. Slow on purpose: this runs all
     * day, and a 1-second loop here is a measurable battery cost.
     */
    private fun startStatusLoop() {
        statusJob?.cancel()
        statusJob = scope.launch {
            var lastSummary = ""
            while (true) {
                val router = router
                val set = transports
                if (router != null && set != null) {
                    val status = router.status()
                    val summary = "${status.foregroundPackage}|${status.isPlaying}|${set.liveIds()}"
                    if (summary != lastSummary) {
                        lastSummary = summary
                        set.broadcast(router.event("status", status))
                        updateNotification(describe(set.liveIds()))
                    }
                }
                delay(3_000)
            }
        }
    }

    private fun describe(live: List<String>): String = when {
        live.isEmpty() -> "In ascolto, nessun controller collegato"
        else -> "Collegato via ${live.joinToString(", ")}"
    }

    override fun onDestroy() {
        transports?.stop()
        scope.cancel()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    // ------------------------------------------------------------ notification

    private fun buildNotification(text: String): Notification {
        val manager = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            manager.createNotificationChannel(
                NotificationChannel(
                    CHANNEL_ID,
                    "Skipper attivo",
                    // MIN so the persistent notification stays out of the way.
                    NotificationManager.IMPORTANCE_MIN,
                ),
            )
        }

        val open = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE,
        )

        return Notification.Builder(this, CHANNEL_ID)
            .setContentTitle("Skipper Screen")
            .setContentText(text)
            .setSmallIcon(R.drawable.ic_relay)
            .setContentIntent(open)
            .setOngoing(true)
            .build()
    }

    private fun updateNotification(text: String) {
        getSystemService(NotificationManager::class.java)
            .notify(NOTIFICATION_ID, buildNotification(text))
    }

    companion object {
        /**
         * Starts the relay if the platform currently allows it, and says so
         * rather than dying if it does not.
         *
         * Android 12 onwards refuses startForegroundService from the background
         * and throws ForegroundServiceStartNotAllowedException, which is fatal
         * where it is called from. The call sites that matter are all allowed —
         * an activity in the foreground, and BOOT_COMPLETED, which carries its
         * own exemption — but MY_PACKAGE_REPLACED does not, and neither does a
         * process the system revived on its own. Those cases have to degrade to
         * "the user opens the app once", not to a crash loop.
         */
        fun ensureRunning(context: Context) {
            try {
                ContextCompat.startForegroundService(
                    context,
                    Intent(context, RelayForegroundService::class.java),
                )
            } catch (e: Exception) {
                Log.w(TAG, "Cannot start the relay from here yet", e)
            }
        }

        const val PREFS = "relay.config"
        const val KEY_PAIR_CODE = "pairCode"
        const val KEY_RELAY_URL = "relayUrl"
        const val KEY_MQTT_URL = "mqttUrl"
        /** Comma-separated transport ids the user switched off. */
        const val KEY_DISABLED = "disabledTransports"
        private const val CHANNEL_ID = "relay.status"
        private const val NOTIFICATION_ID = 4711
        private const val TAG = "RelayForegroundService"
    }
}
