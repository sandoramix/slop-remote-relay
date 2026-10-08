package dev.sandoramix.skipper.screen.transport

import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.TimeUnit
import kotlin.math.min
import kotlin.random.Random

/**
 * The relay over plain HTTP: long-poll to receive, POST to reply. The receiver
 * side of RelayHttpTransport.ts.
 *
 * For networks that break WebSockets. The relay delivers a frame on the same
 * channel it arrived on when the peer has one, so a controller on HTTP reaches
 * this and a controller on the WebSocket reaches RelayClientTransport, and the
 * two paths stay independent.
 */
class RelayHttpTransport(
    relayUrl: String,
    private val room: String,
    private val scope: CoroutineScope,
) : Transport {

    override val id = "http"
    override val priority = 12

    private val base = relayUrl.trimEnd('/')
        .replaceFirst(Regex("^ws", RegexOption.IGNORE_CASE), "http")
    private val sid = UUID.randomUUID().toString().replace("-", "").take(16)
    private val http = OkHttpClient.Builder()
        .readTimeout(HOLD_MS + 15_000, TimeUnit.MILLISECONDS)
        .build()

    private var loop: Job? = null
    @Volatile private var lastPollOk = 0L

    private fun endpoint(action: String) = "$base/room/$room/$action?role=receiver&sid=$sid"

    override fun start(onFrame: suspend (String, String) -> String?) {
        loop = scope.launch {
            var attempt = 0
            while (isActive) {
                try {
                    val request = Request.Builder()
                        .url("${endpoint("poll")}&hold=$HOLD_MS")
                        .header("cache-control", "no-cache")
                        .build()
                    val frames = http.newCall(request).execute().use { res ->
                        if (!res.isSuccessful) error("HTTP ${res.code}")
                        JSONObject(res.body?.string() ?: "{}").optJSONArray("frames")
                    }
                    lastPollOk = System.currentTimeMillis()
                    attempt = 0
                    if (frames != null) {
                        for (i in 0 until frames.length()) {
                            val frame = frames.getString(i)
                            launch { onFrame(frame, id)?.let { send(it) } }
                        }
                    }
                } catch (e: Exception) {
                    if (!isActive) break
                    val backoff = min(1000L shl min(attempt, 5), 30_000L)
                    val wait = (backoff * (0.5 + Random.nextDouble() * 0.5)).toLong()
                    attempt++
                    Log.w(TAG, "poll failed (${e.message}) — retry in ${wait}ms")
                    delay(wait)
                }
            }
        }
    }

    override fun send(raw: String) {
        scope.launch {
            runCatching {
                val request = Request.Builder()
                    .url(endpoint("send"))
                    .post(raw.toRequestBody("text/plain; charset=utf-8".toMediaType()))
                    .build()
                http.newCall(request).execute().close()
            }.onFailure { Log.w(TAG, "send failed: ${it.message}") }
        }
    }

    /** Up while polls keep coming back; one missed hold period is tolerated. */
    override fun isUp(): Boolean = System.currentTimeMillis() - lastPollOk < HOLD_MS + 20_000

    override fun stop() {
        loop?.cancel()
        loop = null
        lastPollOk = 0
    }

    private companion object {
        const val TAG = "RelayHttpTransport"
        const val HOLD_MS = 25_000L
    }
}
