package com.relay.receiver.transport

import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import okio.ByteString.Companion.toByteString
import kotlin.math.min
import kotlin.random.Random

/**
 * Remote path through an MQTT broker, independent of our own relay.
 *
 * Subscribes to relayctl/<room>/receiver and answers on relayctl/<room>/controller.
 * A public broker is acceptable because every frame is HMAC-signed with a key
 * the broker never sees: it can read the traffic but cannot forge or replay it.
 */
class MqttTransport(
    private val url: String,
    private val room: String,
    private val scope: CoroutineScope,
) : Transport {

    override val id = "mqtt"
    override val priority = 15

    private val http = OkHttpClient()
    private var socket: WebSocket? = null
    private var keepAlive: Job? = null
    @Volatile private var subscribed = false
    private var attempt = 0
    private var stopped = false
    private var handler: (suspend (String, String) -> String?)? = null

    private val inbox = "$TOPIC_PREFIX/$room/receiver"
    private val outbox = "$TOPIC_PREFIX/$room/controller"

    override fun start(onFrame: suspend (String, String) -> String?) {
        handler = onFrame
        stopped = false
        dial()
    }

    private fun dial() {
        if (stopped) return
        val parser = MqttCodec.Parser()
        val request = Request.Builder()
            .url(url)
            .header("Sec-WebSocket-Protocol", "mqtt")
            .build()

        socket = http.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(ws: WebSocket, response: Response) {
                val clientId = "relay-receiver-" + Random.nextInt(0, Int.MAX_VALUE).toString(16)
                ws.send(MqttCodec.connect(clientId, KEEPALIVE_SEC).toByteString())
            }

            override fun onMessage(ws: WebSocket, bytes: ByteString) {
                for (packet in parser.push(bytes.toByteArray())) {
                    when (packet) {
                        is MqttCodec.Packet.ConnAck ->
                            if (packet.returnCode == 0) ws.send(MqttCodec.subscribe(1, inbox).toByteString())
                            else ws.close(1000, "refused ${packet.returnCode}")
                        is MqttCodec.Packet.SubAck -> {
                            subscribed = packet.granted != 0x80
                            attempt = 0
                            Log.i(TAG, "subscribed to $inbox")
                            startKeepAlive(ws)
                        }
                        is MqttCodec.Packet.Publish -> if (packet.topic == inbox) {
                            scope.launch { handler?.invoke(packet.payload, id)?.let { send(it) } }
                        }
                        else -> Unit
                    }
                }
            }

            override fun onFailure(ws: WebSocket, t: Throwable, response: Response?) {
                lost(t.message ?: "failure")
            }

            override fun onClosed(ws: WebSocket, code: Int, reason: String) {
                lost("closed $code")
            }
        })
    }

    private fun startKeepAlive(ws: WebSocket) {
        keepAlive?.cancel()
        keepAlive = scope.launch {
            while (isActive) {
                delay(KEEPALIVE_SEC * 500L)
                ws.send(MqttCodec.pingreq().toByteString())
            }
        }
    }

    private fun lost(reason: String) {
        subscribed = false
        keepAlive?.cancel()
        if (stopped) return
        val base = min(1000L shl min(attempt, 6), 60_000L)
        val wait = (base * (0.5 + Random.nextDouble() * 0.5)).toLong()
        attempt++
        Log.w(TAG, "broker down ($reason) — redial in ${wait}ms")
        scope.launch {
            delay(wait)
            dial()
        }
    }

    override fun send(raw: String) {
        socket?.send(MqttCodec.publish(outbox, raw).toByteString())
    }

    override fun isUp(): Boolean = subscribed

    override fun stop() {
        stopped = true
        keepAlive?.cancel()
        socket?.let {
            it.send(MqttCodec.disconnect().toByteString())
            it.close(1000, "stopping")
        }
        socket = null
        subscribed = false
    }

    companion object {
        private const val TAG = "MqttTransport"
        private const val KEEPALIVE_SEC = 30
        /** Must match MQTT_TOPIC_PREFIX in messages.ts. */
        const val TOPIC_PREFIX = "relayctl"
        /** Must match DEFAULT_MQTT_URL in messages.ts. */
        const val DEFAULT_URL = "wss://broker.hivemq.com:8884/mqtt"
    }
}
