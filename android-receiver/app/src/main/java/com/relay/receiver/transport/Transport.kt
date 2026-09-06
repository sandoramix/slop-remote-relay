package com.relay.receiver.transport

/**
 * Receiver-side transport. Mirrors the controller's interface but inverted: the
 * receiver mostly listens, so `start` means "become reachable on this path".
 */
interface Transport {
    val id: String
    /** Lower is better. 0 = LAN server, 10 = relay client, 20 = BLE peripheral. */
    val priority: Int

    fun start(onFrame: suspend (raw: String, transportId: String) -> String?)
    fun send(raw: String)
    fun stop()
    fun isUp(): Boolean
}

/**
 * Runs every configured transport at once rather than choosing one.
 *
 * This is the asymmetry with the controller: the receiver has no reason to pick
 * a single path. Being reachable on Wi-Fi, through the relay, and over BLE
 * simultaneously costs almost nothing and means the controller's own failover
 * always has somewhere to land. Dedupe in CommandRouter makes the overlap safe.
 */
class TransportSet(private val transports: List<Transport>) {

    fun start(onFrame: suspend (raw: String, transportId: String) -> String?) {
        transports.sortedBy { it.priority }.forEach { runCatching { it.start(onFrame) } }
    }

    /** Pushes an unsolicited frame (a status event) on every live path. */
    fun broadcast(raw: String) {
        transports.filter { it.isUp() }.forEach { runCatching { it.send(raw) } }
    }

    fun stop() = transports.forEach { runCatching { it.stop() } }

    fun liveIds(): List<String> = transports.filter { it.isUp() }.map { it.id }
}
