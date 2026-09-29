package dev.sandoramix.skipper.screen.core

import android.content.Context
import android.os.BatteryManager
import android.util.Log
import dev.sandoramix.skipper.screen.actions.ExecutorChain
import dev.sandoramix.skipper.screen.actions.MediaSessionExecutor
import dev.sandoramix.skipper.screen.recipes.RecipeEngine
import dev.sandoramix.skipper.screen.service.RelayAccessibilityService
import org.json.JSONObject
import java.util.UUID

/**
 * Single entry point for every inbound frame, whatever transport carried it.
 *
 * Order of operations matters and is the same on every path:
 *   verify signature -> reject replays -> dedupe by id -> execute -> ack
 *
 * The dedupe step is what allows the controller to mirror a command across two
 * transports during a failover: the second copy is dropped here, so a "+30s"
 * pressed once never jumps 60.
 */
class CommandRouter(
    private val context: Context,
    private val secret: String,
    private val chain: ExecutorChain,
    private val mediaSession: MediaSessionExecutor,
    private val recipes: RecipeEngine,
    /** Reads the fullscreen state for device.status; null when nothing can tell. */
    private val fullscreenProbe: (String?) -> Boolean? = { null },
) {

    private val dedupe = DedupeWindow()

    /**
     * Handles one raw frame and returns the reply to send back, or null when the
     * frame warrants no response.
     */
    suspend fun handle(raw: String, transportId: String): String? {
        val verdict = Codec.verify(raw, secret)
        if (verdict is Codec.Verdict.Rejected) {
            Log.w(TAG, "Frame rejected on $transportId: ${verdict.reason}")
            return null
        }

        val env = (verdict as Codec.Verdict.Valid).envelope
        val id = env.optString("id")

        return when (env.optString("type")) {
            "ping" -> pong(env)
            "hello" -> null
            "cmd" -> {
                // Duplicate arrivals are expected, not an error — say nothing.
                if (!dedupe.admit(id)) return null
                executeCommand(env, id)
            }
            else -> null
        }
    }

    private suspend fun executeCommand(env: JSONObject, ref: String): String {
        val started = System.currentTimeMillis()
        val commandJson = env.optJSONObject("cmd")
            ?: return ack(ref, ok = false, detail = "comando mancante", tookMs = 0)

        val command = Command.fromJson(commandJson)
            ?: return ack(ref, ok = false, detail = "operazione sconosciuta", tookMs = 0)

        if (command is Command.Status) {
            return event("status", status())
        }

        val result = chain.run(command)
        return ack(
            ref = ref,
            ok = result.ok,
            executor = result.executor,
            detail = result.detail,
            tookMs = System.currentTimeMillis() - started,
        )
    }

    fun status(): DeviceStatus {
        val snapshot = mediaSession.snapshot()
        val foreground = RelayAccessibilityService.instance?.foregroundPackage
            ?: snapshot?.packageName

        return DeviceStatus(
            foregroundPackage = foreground,
            hasMediaSession = snapshot != null,
            positionMs = snapshot?.positionMs,
            durationMs = snapshot?.durationMs,
            isPlaying = snapshot?.isPlaying ?: false,
            executors = chain.available(),
            recipeKnown = recipes.knows(foreground),
            batteryPercent = batteryPercent(),
            title = snapshot?.title,
            fullscreen = fullscreenProbe(foreground),
        )
    }

    private fun batteryPercent(): Int? = try {
        val bm = context.getSystemService(Context.BATTERY_SERVICE) as? BatteryManager
        bm?.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
    } catch (e: Exception) {
        null
    }

    // ------------------------------------------------------------------ replies

    private fun ack(
        ref: String,
        ok: Boolean,
        executor: ExecutorId? = null,
        detail: String? = null,
        tookMs: Long,
    ): String = signed(
        JSONObject().apply {
            put("type", "ack")
            put("ref", ref)
            put("ok", ok)
            executor?.let { put("executedBy", it.wire) }
            detail?.let { put("detail", it) }
            put("tookMs", tookMs)
        },
    )

    fun event(name: String, status: DeviceStatus? = null, detail: String? = null): String =
        signed(
            JSONObject().apply {
                put("type", "event")
                put("event", name)
                status?.let { put("status", it.toJson()) }
                detail?.let { put("detail", it) }
            },
        )

    private fun pong(ping: JSONObject): String = signed(
        JSONObject().apply {
            put("type", "pong")
            put("nonce", ping.optString("nonce"))
        },
        // Echo the original timestamp so the controller measures true round-trip
        // time rather than the receiver's clock offset.
        overrideTs = ping.optLong("ts"),
    )

    private fun signed(body: JSONObject, overrideTs: Long? = null): String {
        body.put("v", PROTOCOL_VERSION)
        body.put("id", UUID.randomUUID().toString())
        body.put("ts", overrideTs ?: System.currentTimeMillis())
        body.put("sig", Codec.hmacHex(secret, Codec.canonicalize(body)))
        return body.toString()
    }

    private companion object {
        const val TAG = "CommandRouter"
    }
}
