package com.relay.receiver.transport

import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import java.util.concurrent.TimeUnit
import kotlin.math.min
import kotlin.random.Random

/**
 * Path 2 — outbound WebSocket to the rendezvous relay.
 *
 * Outbound is the point: the receiver dials out, so it works behind carrier NAT
 * and needs no port forwarding. Reconnection is aggressive because this is the
 * path that has to be up when the controller is not on the local network, and
 * there is nobody around to restart the app.
 */
class RelayClientTransport(
    private val url: String,
    private val room: String,
    private val scope: CoroutineScope,
) : Transport {

    override val id = "relay"
    override val priority = 10

    private val http = OkHttpClient.Builder()
        .pingInterval(20, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .build()

    private var socket: WebSocket? = null
    private var connected = false
    private var attempt = 0
    private var stopped = false
    private var handler: (suspend (String, String) -> String?)? = null

    override fun start(onFrame: suspend (String, String) -> String?) {
        handler = onFrame
        stopped = false
        dial()
    }

    private fun dial() {
        if (stopped) return
        val request = Request.Builder()
            .url("${url.trimEnd('/')}/room/$room?role=receiver&ch=ws")
            .build()

        socket = http.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(ws: WebSocket, response: Response) {
                connected = true
                attempt = 0
                Log.i(TAG, "relay connected")
            }

            override fun onMessage(ws: WebSocket, text: String) {
                scope.launch {
                    handler?.invoke(text, id)?.let { runCatching { ws.send(it) } }
                }
            }

            override fun onFailure(ws: WebSocket, t: Throwable, response: Response?) {
                connected = false
                scheduleRedial(t.message ?: "failure")
            }

            override fun onClosed(ws: WebSocket, code: Int, reason: String) {
                connected = false
                scheduleRedial("closed $code")
            }
        })
    }

    /** Exponential backoff with jitter, capped at a minute. */
    private fun scheduleRedial(reason: String) {
        if (stopped) return
        val base = min(1000L shl min(attempt, 6), 60_000L)
        val delay = (base * (0.5 + Random.nextDouble() * 0.5)).toLong()
        attempt++
        Log.w(TAG, "relay down ($reason) — redial in ${delay}ms")
        scope.launch {
            kotlinx.coroutines.delay(delay)
            dial()
        }
    }

    override fun send(raw: String) { socket?.send(raw) }
    override fun isUp(): Boolean = connected

    override fun stop() {
        stopped = true
        socket?.close(1000, "stopping")
        socket = null
        connected = false
    }

    private companion object { const val TAG = "RelayClientTransport" }
}
