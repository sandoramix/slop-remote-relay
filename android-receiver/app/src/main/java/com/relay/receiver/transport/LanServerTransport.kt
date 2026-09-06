package com.relay.receiver.transport

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import org.java_websocket.WebSocket
import org.java_websocket.handshake.ClientHandshake
import org.java_websocket.server.WebSocketServer
import java.net.InetSocketAddress

/**
 * Path 1 — WebSocket server on the local network, advertised over NSD/mDNS.
 *
 * Single-digit latency, no infrastructure, and the only path that survives an
 * internet outage. The controller finds it by service discovery, so there is no
 * IP to type in as long as both devices are on the same network.
 */
class LanServerTransport(
    private val context: Context,
    private val scope: CoroutineScope,
    private val port: Int = 47821,
) : Transport {

    override val id = "lan"
    override val priority = 0

    private var server: WebSocketServer? = null
    private val clients = mutableSetOf<WebSocket>()
    private var nsd: NsdManager? = null
    private var registration: NsdManager.RegistrationListener? = null

    override fun start(onFrame: suspend (String, String) -> String?) {
        val ws = object : WebSocketServer(InetSocketAddress(port)) {
            override fun onOpen(conn: WebSocket, handshake: ClientHandshake) {
                synchronized(clients) { clients.add(conn) }
                Log.i(TAG, "controller connected from ${conn.remoteSocketAddress}")
            }

            override fun onClose(conn: WebSocket, code: Int, reason: String?, remote: Boolean) {
                synchronized(clients) { clients.remove(conn) }
            }

            override fun onMessage(conn: WebSocket, message: String) {
                scope.launch {
                    onFrame(message, id)?.let { reply ->
                        runCatching { conn.send(reply) }
                    }
                }
            }

            override fun onError(conn: WebSocket?, ex: Exception) {
                Log.w(TAG, "socket error", ex)
            }

            override fun onStart() {
                connectionLostTimeout = 30
                Log.i(TAG, "listening on :$port")
                advertise()
            }
        }
        ws.isReuseAddr = true
        ws.start()
        server = ws
    }

    override fun send(raw: String) {
        synchronized(clients) { clients.toList() }.forEach { runCatching { it.send(raw) } }
    }

    override fun isUp(): Boolean = synchronized(clients) { clients.isNotEmpty() }

    override fun stop() {
        registration?.let { runCatching { nsd?.unregisterService(it) } }
        runCatching { server?.stop(1000) }
        server = null
        synchronized(clients) { clients.clear() }
    }

    /** mDNS advertisement, so the controller never needs a hardcoded address. */
    private fun advertise() {
        val manager = context.getSystemService(Context.NSD_SERVICE) as? NsdManager ?: return
        val info = NsdServiceInfo().apply {
            serviceName = "RelayReceiver"
            serviceType = "_relayctl._tcp"
            setPort(port)
        }
        val listener = object : NsdManager.RegistrationListener {
            // Block bodies, not expression bodies: Log.i/Log.w return Int and the
            // listener methods are void.
            override fun onServiceRegistered(info: NsdServiceInfo) {
                Log.i(TAG, "advertised as ${info.serviceName}")
            }
            override fun onRegistrationFailed(info: NsdServiceInfo, code: Int) {
                Log.w(TAG, "mDNS registration failed: $code")
            }
            override fun onServiceUnregistered(info: NsdServiceInfo) = Unit
            override fun onUnregistrationFailed(info: NsdServiceInfo, code: Int) = Unit
        }
        manager.registerService(info, NsdManager.PROTOCOL_DNS_SD, listener)
        nsd = manager
        registration = listener
    }

    private companion object { const val TAG = "LanServerTransport" }
}
