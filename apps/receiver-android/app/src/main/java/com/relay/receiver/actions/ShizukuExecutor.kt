package com.relay.receiver.actions

import android.content.Context
import android.util.Log
import com.relay.receiver.core.Command
import com.relay.receiver.core.ExecResult
import com.relay.receiver.core.ExecutorId
import com.relay.receiver.recipes.RecipeEngine
import com.relay.receiver.recipes.Step
import com.relay.receiver.service.RelayAccessibilityService
import com.relay.receiver.shizuku.ShizukuBridge
import kotlinx.coroutines.delay

/**
 * Shell-privileged execution through Shizuku. Last in the chain: the most
 * powerful layer and the most demanding to keep running (see docs/SHIZUKU.md).
 *
 * What it adds over accessibility:
 *  - key events into the foreground app (KEYCODE_F and KEYCODE_ESCAPE drive a
 *    web player's fullscreen, which is where Chrome and Brave were weakest)
 *  - taps and rotation with no accessibility service at all, so fullscreen
 *    survives Advanced Protection Mode and Restricted Settings
 *  - the foreground package from the activity manager, when accessibility is
 *    not there to report it
 *
 * Every command is a fixed template with validated arguments. Recipes can name
 * a key code; they cannot name a command.
 */
class ShizukuExecutor(
    private val context: Context,
    private val recipes: RecipeEngine,
    /**
     * Reads the fullscreen state (AccessibilityExecutor.isFullscreen), or null
     * when nothing can tell. A key event "succeeds" as soon as it is injected,
     * whether or not the page reacts, so without this every key step would
     * report success.
     */
    private val fullscreenState: () -> Boolean? = { null },
) : ActionExecutor {

    override val id = ExecutorId.SHIZUKU

    override fun isAvailable(): Boolean = ShizukuBridge.available()

    override fun canHandle(command: Command): Boolean = when (command) {
        is Command.Fullscreen, is Command.FullscreenExit, is Command.Seek, is Command.PlayPause -> true
        else -> false
    }

    override suspend fun execute(command: Command): ExecResult = when (command) {
        is Command.Fullscreen ->
            if (command.toggle && fullscreenState() == true) runSteps(exitSteps(), "exit", want = false)
            else runSteps(fullscreenSteps(), "fullscreen", want = true)
        is Command.FullscreenExit -> runSteps(exitSteps(), "exit", want = false)
        is Command.PlayPause -> key("KEYCODE_MEDIA_PLAY_PAUSE")
            ?.let { ExecResult.ok(id, "media key") }
            ?: ExecResult.fail(id, "Shizuku non risponde")
        is Command.Seek -> seekByTapping(command.deltaMs)
        else -> ExecResult.notHandled(id)
    }

    private suspend fun pkg(): String? =
        RelayAccessibilityService.instance?.foregroundPackage ?: foregroundPackage()

    private suspend fun fullscreenSteps(): List<Step> =
        recipes.forPackage(pkg())?.fullscreen?.takeIf { it.isNotEmpty() } ?: recipes.fallbackFullscreen()

    private suspend fun exitSteps(): List<Step> =
        recipes.forPackage(pkg())?.exitFullscreen?.takeIf { it.isNotEmpty() }
            ?: listOf(Step.Key("KEYCODE_ESCAPE"), Step.Back)

    private suspend fun runSteps(steps: List<Step>, what: String, want: Boolean): ExecResult {
        val target = pkg()
        if (fullscreenState() == want) return ExecResult.ok(id, "già nello stato richiesto")
        for (step in steps) {
            val done = when (step) {
                is Step.Key -> key(step.code) != null
                is Step.Tap -> tap(step.x, step.y, step.double)
                is Step.Reveal -> {
                    tap(step.x, step.y, double = false)
                    delay(step.settleMs)
                    false
                }
                is Step.Back -> key("KEYCODE_BACK") != null
                is Step.Rotate -> rotate(step.landscape)
                // Tree search needs accessibility, which already had its turn.
                is Step.Node, is Step.MediaSession -> false
            }
            Log.d(TAG, "$what ${step::class.simpleName} -> $done")
            if (!done) continue
            delay(VERIFY_MS)
            when (fullscreenState()) {
                want -> return ExecResult.ok(id, "$what ${step::class.simpleName} on ${target ?: "?"}")
                null -> return ExecResult.ok(
                    id,
                    "$what ${step::class.simpleName} inviato su ${target ?: "?"} (non verificato)",
                )
                else -> Unit // injected, no effect: try the next step
            }
        }
        return ExecResult.fail(id, "Nessun passo Shizuku applicabile su ${target ?: "app sconosciuta"}")
    }

    private suspend fun seekByTapping(deltaMs: Long): ExecResult {
        val steps = recipes.forPackage(pkg())?.seek?.takeIf { it.isNotEmpty() } ?: recipes.fallbackSeek()
        val tapStep = steps.filterIsInstance<Step.Tap>().firstOrNull()
            ?: return ExecResult.notHandled(id)
        val taps = ((kotlin.math.abs(deltaMs) + SEEK_STEP_MS / 2) / SEEK_STEP_MS).toInt().coerceAtLeast(1)
        val x = if (deltaMs >= 0) tapStep.x else 1f - tapStep.x
        repeat(taps) {
            tap(x, tapStep.y, tapStep.double)
            delay(TAP_SETTLE_MS)
        }
        return ExecResult.ok(id, "$taps tap via Shizuku (impreciso)")
    }

    // --------------------------------------------------------------- templates

    private suspend fun key(code: String): Int? {
        if (!KEYCODE.matches(code)) {
            Log.w(TAG, "refusing key code $code")
            return null
        }
        return ShizukuBridge.run("input", "keyevent", code)?.first?.takeIf { it == 0 }
    }

    private suspend fun tap(nx: Float, ny: Float, double: Boolean): Boolean {
        val m = context.resources.displayMetrics
        val x = (nx.coerceIn(0f, 1f) * m.widthPixels).toInt().toString()
        val y = (ny.coerceIn(0f, 1f) * m.heightPixels).toInt().toString()
        val first = ShizukuBridge.run("input", "tap", x, y)?.first == 0
        if (double) {
            delay(90)
            ShizukuBridge.run("input", "tap", x, y)
        }
        return first
    }

    private suspend fun rotate(landscape: Boolean): Boolean {
        val lock = ShizukuBridge.run("settings", "put", "system", "accelerometer_rotation", "0")
        val set = ShizukuBridge.run("settings", "put", "system", "user_rotation", if (landscape) "1" else "0")
        return lock?.first == 0 && set?.first == 0
    }

    /** Foreground package from the activity manager: `mResumedActivity: … com.pkg/.Activity`. */
    private suspend fun foregroundPackage(): String? {
        val out = ShizukuBridge.run("dumpsys", "activity", "activities")?.second ?: return null
        val line = out.lineSequence().firstOrNull {
            it.contains("mResumedActivity") || it.contains("topResumedActivity")
        } ?: return null
        return PACKAGE_IN_RECORD.find(line)?.groupValues?.get(1)
    }

    private companion object {
        const val TAG = "ShizukuExecutor"
        const val SEEK_STEP_MS = 10_000L
        const val TAP_SETTLE_MS = 320L
        const val VERIFY_MS = 700L
        val KEYCODE = Regex("^KEYCODE_[A-Z0-9_]{1,40}$")
        val PACKAGE_IN_RECORD = Regex("""\s([a-zA-Z][\w.]+)/[\w.$]+""")
    }
}
