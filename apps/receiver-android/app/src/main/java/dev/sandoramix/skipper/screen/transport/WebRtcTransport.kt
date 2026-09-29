package dev.sandoramix.skipper.screen.transport

import android.content.Context
import android.util.Log
import dev.sandoramix.skipper.screen.core.Codec
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import org.webrtc.DataChannel
import org.webrtc.IceCandidate
import org.webrtc.MediaConstraints
import org.webrtc.MediaStream
import org.webrtc.PeerConnection
import org.webrtc.PeerConnectionFactory
import org.webrtc.RtpReceiver
import org.webrtc.SdpObserver
import org.webrtc.SessionDescription
import java.nio.ByteBuffer
import kotlin.math.min
import kotlin.random.Random

/**
 * Peer-to-peer DataChannel, answering side. The controller offers; this keeps a
 * signalling socket open in the relay's sibling room `<room>-rtc`, says `ready`
 * on arrival so a controller already waiting re-offers, and answers every offer
 * with a fresh peer connection.
 *
 * Signalling is HMAC-signed with the pair secret over `rtc|k|sid|ts|d`, where
 * `d` is the payload as a JSON string — the same bytes WebRtcTransport.ts signs,
 * whatever order either JSON library puts keys in.
 */
class WebRtcTransport(
    private val context: Context,
    private val signalUrl: String,
    private val room: String,
    private val secret: String,
    private val scope: CoroutineScope,
    private val stunUrls: List<String> = DEFAULT_STUN,
) : Transport {

    override val id = "webrtc"
    override val priority = 5

    private val http = OkHttpClient()
    private var signal: WebSocket? = null
    private var pc: PeerConnection? = null
    private var channel: DataChannel? = null
    private var sid = ""
    private val pendingIce = mutableListOf<IceCandidate>()
    private var remoteSet = false
    private var stopped = false
    private var attempt = 0
    private var handler: (suspend (String, String) -> String?)? = null

    override fun start(onFrame: suspend (String, String) -> String?) {
        handler = onFrame
        stopped = false
        ensureFactory(context)
        dial()
    }

    private fun dial() {
        if (stopped) return
        val request = Request.Builder()
            .url("${signalUrl.trimEnd('/')}/room/$room$RTC_ROOM_SUFFIX?role=receiver&ch=ws")
            .build()
        signal = http.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(ws: WebSocket, response: Response) {
                attempt = 0
                sendSignal("ready", JSONObject())
            }

            // Handled inline, not launched: OkHttp delivers messages one at a
            // time on its reader thread, and an offer must be applied before
            // the ICE candidates that follow it.
            override fun onMessage(ws: WebSocket, text: String) = onSignal(text)

            override fun onFailure(ws: WebSocket, t: Throwable, response: Response?) = redial(t.message)
            override fun onClosed(ws: WebSocket, code: Int, reason: String) = redial("closed $code")
        })
    }

    private fun redial(reason: String?) {
        if (stopped) return
        val base = min(1000L shl min(attempt, 6), 60_000L)
        val wait = (base * (0.5 + Random.nextDouble() * 0.5)).toLong()
        attempt++
        Log.w(TAG, "signalling down ($reason) — redial in ${wait}ms")
        scope.launch {
            delay(wait)
            dial()
        }
    }

    private fun onSignal(raw: String) {
        val s = runCatching { JSONObject(raw) }.getOrNull() ?: return
        val k = s.optString("k")
        val msgSid = s.optString("sid")
        val ts = s.optLong("ts")
        val d = s.optString("d", "")
        val expected = Codec.hmacHex(secret, signable(k, msgSid, ts, d))
        if (expected != s.optString("sig")) {
            Log.w(TAG, "unsigned or forged signalling dropped")
            return
        }
        if (kotlin.math.abs(System.currentTimeMillis() - ts) > 60_000) return
        val data = runCatching { JSONObject(d) }.getOrNull() ?: return

        when (k) {
            "offer" -> answer(msgSid, data.optString("sdp"))
            "ice" -> if (msgSid == sid) addIce(
                IceCandidate(
                    data.optString("sdpMid"),
                    data.optInt("sdpMLineIndex"),
                    data.optString("candidate"),
                ),
            )
        }
    }

    private fun answer(offerSid: String, sdp: String) {
        sid = offerSid
        closePeer()
        remoteSet = false
        pendingIce.clear()

        val servers = if (stunUrls.isEmpty()) emptyList() else listOf(
            PeerConnection.IceServer.builder(stunUrls).createIceServer(),
        )
        val config = PeerConnection.RTCConfiguration(servers).apply {
            sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
        }
        val peer = factory!!.createPeerConnection(config, object : PeerConnection.Observer {
            override fun onIceCandidate(c: IceCandidate) {
                sendSignal(
                    "ice",
                    JSONObject()
                        .put("candidate", c.sdp)
                        .put("sdpMid", c.sdpMid)
                        .put("sdpMLineIndex", c.sdpMLineIndex),
                )
            }
            override fun onDataChannel(dc: DataChannel) = bindChannel(dc)
            override fun onIceConnectionChange(state: PeerConnection.IceConnectionState) {
                Log.i(TAG, "ice $state")
            }
            override fun onSignalingChange(state: PeerConnection.SignalingState) = Unit
            override fun onIceConnectionReceivingChange(receiving: Boolean) = Unit
            override fun onIceGatheringChange(state: PeerConnection.IceGatheringState) = Unit
            override fun onIceCandidatesRemoved(candidates: Array<out IceCandidate>) = Unit
            override fun onAddStream(stream: MediaStream) = Unit
            override fun onRemoveStream(stream: MediaStream) = Unit
            override fun onRenegotiationNeeded() = Unit
            override fun onAddTrack(receiver: RtpReceiver, streams: Array<out MediaStream>) = Unit
        }) ?: return
        pc = peer

        peer.setRemoteDescription(object : SdpAdapter() {
            override fun onSetSuccess() {
                // WebRTC calls back on its own thread; candidates are queued
                // from OkHttp's. The lock keeps one from slipping between.
                synchronized(pendingIce) {
                    remoteSet = true
                    pendingIce.forEach { peer.addIceCandidate(it) }
                    pendingIce.clear()
                }
                peer.createAnswer(object : SdpAdapter() {
                    override fun onCreateSuccess(desc: SessionDescription) {
                        peer.setLocalDescription(object : SdpAdapter() {
                            override fun onSetSuccess() {
                                sendSignal(
                                    "answer",
                                    JSONObject().put("type", "answer").put("sdp", desc.description),
                                )
                            }
                        }, desc)
                    }
                }, MediaConstraints())
            }
        }, SessionDescription(SessionDescription.Type.OFFER, sdp))
    }

    private fun addIce(candidate: IceCandidate) {
        val peer = pc ?: return
        synchronized(pendingIce) {
            if (remoteSet) peer.addIceCandidate(candidate) else pendingIce.add(candidate)
        }
    }

    private fun bindChannel(dc: DataChannel) {
        channel = dc
        dc.registerObserver(object : DataChannel.Observer {
            override fun onBufferedAmountChange(previous: Long) = Unit
            override fun onStateChange() {
                Log.i(TAG, "data channel ${dc.state()}")
            }
            override fun onMessage(buffer: DataChannel.Buffer) {
                val bytes = ByteArray(buffer.data.remaining())
                buffer.data.get(bytes)
                val text = String(bytes, Charsets.UTF_8)
                scope.launch { handler?.invoke(text, id)?.let { send(it) } }
            }
        })
    }

    private fun sendSignal(k: String, data: JSONObject) {
        val d = data.toString()
        val ts = System.currentTimeMillis()
        val body = JSONObject()
            .put("k", k)
            .put("sid", sid)
            .put("ts", ts)
            .put("d", d)
            .put("sig", Codec.hmacHex(secret, signable(k, sid, ts, d)))
        signal?.send(body.toString())
    }

    override fun send(raw: String) {
        val dc = channel ?: return
        if (dc.state() != DataChannel.State.OPEN) return
        dc.send(DataChannel.Buffer(ByteBuffer.wrap(raw.toByteArray(Charsets.UTF_8)), false))
    }

    override fun isUp(): Boolean = channel?.state() == DataChannel.State.OPEN

    private fun closePeer() {
        channel?.let { runCatching { it.unregisterObserver(); it.close() } }
        channel = null
        pc?.let { runCatching { it.close() } }
        pc = null
    }

    override fun stop() {
        stopped = true
        closePeer()
        signal?.close(1000, "stopping")
        signal = null
    }

    /** SdpObserver with no-op defaults, so each step overrides only its success. */
    private open class SdpAdapter : SdpObserver {
        override fun onCreateSuccess(desc: SessionDescription) = Unit
        override fun onSetSuccess() = Unit
        override fun onCreateFailure(error: String?) { Log.w(TAG, "sdp create: $error") }
        override fun onSetFailure(error: String?) { Log.w(TAG, "sdp set: $error") }
    }

    companion object {
        private const val TAG = "WebRtcTransport"
        /** Must match RTC_ROOM_SUFFIX in messages.ts. */
        const val RTC_ROOM_SUFFIX = "-rtc"
        val DEFAULT_STUN = listOf("stun:stun.l.google.com:19302", "stun:stun.cloudflare.com:3478")

        /** What the signalling HMAC covers. Same string as `signable` in webrtc.ts. */
        fun signable(k: String, sid: String, ts: Long, d: String) = "rtc|$k|$sid|$ts|$d"

        private var factory: PeerConnectionFactory? = null

        @Synchronized
        private fun ensureFactory(context: Context) {
            if (factory != null) return
            PeerConnectionFactory.initialize(
                PeerConnectionFactory.InitializationOptions.builder(context.applicationContext)
                    .createInitializationOptions(),
            )
            factory = PeerConnectionFactory.builder().createPeerConnectionFactory()
        }
    }
}
