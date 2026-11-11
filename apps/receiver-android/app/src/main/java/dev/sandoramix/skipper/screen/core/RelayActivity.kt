package dev.sandoramix.skipper.screen.core

/**
 * What the receiver is doing right now, for the main screen and the notification.
 *
 * In memory only, one process, never persisted and never sent anywhere: it exists
 * so the person in front of the screen can see whether a controller is really
 * talking to it and what it just asked for.
 *
 * "Connected" means a correctly signed frame from the controller arrived
 * recently. A transport being up is not enough: the LAN server listening, or the
 * MQTT broker connection being open, says nothing about anyone being there. The
 * controller pings the active path every few seconds, so a live controller is
 * seen well inside [CONNECTED_WINDOW_MS].
 */
object RelayActivity {

    /** One command the controller sent, and how it went. */
    data class Entry(
        val atMs: Long,
        val command: Command,
        val ok: Boolean,
        /** Transport id the command arrived on. */
        val via: String,
        /** Wire name of the layer that acted, or null when none could. */
        val executor: String?,
        val detail: String?,
    )

    const val MAX_ENTRIES = 8
    const val CONNECTED_WINDOW_MS = 20_000L

    private val lock = Any()
    private val entries = ArrayDeque<Entry>()

    /** Transport ids that are up (listening or connected to their server). */
    @Volatile
    var livePaths: List<String> = emptyList()

    @Volatile
    var lastSeenMs: Long = 0L
        private set

    @Volatile
    private var lastSeenVia: String? = null

    /** Called for every valid signed frame from the controller, heartbeats included. */
    fun controllerSeen(via: String, nowMs: Long = System.currentTimeMillis()) {
        lastSeenVia = via
        lastSeenMs = nowMs
    }

    /** The path the controller was last heard on, or null when it has been quiet too long. */
    fun connectedVia(nowMs: Long = System.currentTimeMillis()): String? =
        lastSeenVia?.takeIf { lastSeenMs > 0 && nowMs - lastSeenMs <= CONNECTED_WINDOW_MS }

    fun record(entry: Entry) {
        synchronized(lock) {
            entries.addFirst(entry)
            while (entries.size > MAX_ENTRIES) entries.removeLast()
        }
    }

    /** Newest first. */
    fun recent(): List<Entry> = synchronized(lock) { entries.toList() }

    /** For tests and for a fresh pairing. */
    fun reset() {
        synchronized(lock) { entries.clear() }
        livePaths = emptyList()
        lastSeenMs = 0L
        lastSeenVia = null
    }
}
