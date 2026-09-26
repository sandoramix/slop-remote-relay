package com.relay.receiver.core

import org.json.JSONObject

/** Kotlin mirror of packages/protocol/src/messages.ts. Keep the two in step. */

const val PROTOCOL_VERSION = 1
const val SKEW_TOLERANCE_MS = 30_000L
const val DEDUPE_WINDOW_SIZE = 256

sealed interface Command {
    data class Fullscreen(val toggle: Boolean = true) : Command
    data object FullscreenExit : Command
    data class Seek(val deltaMs: Long) : Command
    data class SeekTo(val positionMs: Long) : Command
    data class PlayPause(val play: Boolean?) : Command
    data object Status : Command

    companion object {
        fun fromJson(json: JSONObject): Command? = when (json.optString("op")) {
            "fullscreen.enter" -> Fullscreen(json.optBoolean("toggle", true))
            "fullscreen.exit" -> FullscreenExit
            "playback.seek" -> Seek(json.optLong("deltaMs"))
            "playback.seekTo" -> SeekTo(json.optLong("positionMs").coerceAtLeast(0))
            "playback.playPause" ->
                PlayPause(if (json.has("play")) json.getBoolean("play") else null)
            "device.status" -> Status
            else -> null
        }
    }
}

enum class ExecutorId(val wire: String) {
    MEDIASESSION("mediasession"),
    ACCESSIBILITY("accessibility"),
    SHIZUKU("shizuku"),
    SETTINGS("settings"),
    // Browser extension receiver only; listed so the enum mirrors messages.ts.
    DOM("dom"),
    CDP("cdp"),
}

/**
 * Three outcomes, not two. `notHandled` means "this layer does not apply here",
 * which lets the chain move on quietly; `fail` means "this layer applies and it
 * did not work", which is worth surfacing to the user.
 */
data class ExecResult(
    val handled: Boolean,
    val ok: Boolean,
    val executor: ExecutorId?,
    val detail: String?,
) {
    companion object {
        fun ok(executor: ExecutorId, detail: String? = null) =
            ExecResult(handled = true, ok = true, executor = executor, detail = detail)

        fun fail(executor: ExecutorId, detail: String) =
            ExecResult(handled = true, ok = false, executor = executor, detail = detail)

        fun notHandled(executor: ExecutorId? = null) =
            ExecResult(handled = false, ok = false, executor = executor, detail = null)
    }
}

data class DeviceStatus(
    val foregroundPackage: String?,
    val hasMediaSession: Boolean,
    val positionMs: Long?,
    val durationMs: Long?,
    val isPlaying: Boolean,
    val executors: List<ExecutorId>,
    val recipeKnown: Boolean,
    val batteryPercent: Int?,
    val title: String? = null,
    val fullscreen: Boolean? = null,
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("foregroundPackage", foregroundPackage ?: JSONObject.NULL)
        put("hasMediaSession", hasMediaSession)
        put("positionMs", positionMs ?: JSONObject.NULL)
        put("durationMs", durationMs ?: JSONObject.NULL)
        put("isPlaying", isPlaying)
        put("executors", org.json.JSONArray(executors.map { it.wire }))
        put("recipeKnown", recipeKnown)
        put("batteryPercent", batteryPercent ?: JSONObject.NULL)
        put("kind", "android")
        put("title", title ?: JSONObject.NULL)
        put("fullscreen", fullscreen ?: JSONObject.NULL)
    }
}
