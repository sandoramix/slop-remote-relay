package com.relay.receiver.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.util.Log
import com.relay.receiver.R
import com.relay.receiver.actions.AccessibilityExecutor
import com.relay.receiver.actions.ExecutorChain
import com.relay.receiver.actions.MediaSessionExecutor
import com.relay.receiver.core.Codec
import com.relay.receiver.core.CommandRouter
import com.relay.receiver.recipes.RecipeEngine
import com.relay.receiver.transport.BleGattTransport
import com.relay.receiver.transport.LanServerTransport
import com.relay.receiver.transport.RelayClientTransport
import com.relay.receiver.transport.Transport
import com.relay.receiver.transport.TransportSet
import com.relay.receiver.ui.MainActivity
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

        // Preference order. A ShizukuExecutor would slot in after accessibility
        // and needs no other change anywhere in the codebase.
        val chain = ExecutorChain(
            listOf(
                mediaSession,
                AccessibilityExecutor(this, recipes),
            ),
        )

        val commandRouter = CommandRouter(this, secret, chain, mediaSession, recipes)
        router = commandRouter

        val list = mutableListOf<Transport>(
            LanServerTransport(this, scope),
            BleGattTransport(this, scope),
        )
        prefs.getString(KEY_RELAY_URL, null)?.takeIf { it.isNotBlank() }?.let { url ->
            list.add(RelayClientTransport(url, room, scope))
        }

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
                    "Relay attivo",
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
            .setContentTitle("Relay")
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
        const val PREFS = "relay.config"
        const val KEY_PAIR_CODE = "pairCode"
        const val KEY_RELAY_URL = "relayUrl"
        private const val CHANNEL_ID = "relay.status"
        private const val NOTIFICATION_ID = 4711
        private const val TAG = "RelayForegroundService"
    }
}
