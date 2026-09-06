package com.relay.receiver.actions

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.content.Context
import android.graphics.Path
import android.graphics.Rect
import android.provider.Settings
import android.util.Log
import android.view.accessibility.AccessibilityNodeInfo
import com.relay.receiver.core.Command
import com.relay.receiver.core.ExecResult
import com.relay.receiver.core.ExecutorId
import com.relay.receiver.recipes.RecipeEngine
import com.relay.receiver.recipes.Step
import com.relay.receiver.service.RelayAccessibilityService
import kotlinx.coroutines.delay
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume

/**
 * The only route to fullscreen, and the fallback for everything else.
 *
 * Runs the recipe for the foreground package step by step and stops at the first
 * one that reports success. Every step is written so that failure is cheap and
 * silent, because on an unknown app most of them will fail and that is fine.
 */
class AccessibilityExecutor(
    private val context: Context,
    private val recipes: RecipeEngine,
) : ActionExecutor {

    override val id = ExecutorId.ACCESSIBILITY

    private val service: RelayAccessibilityService?
        get() = RelayAccessibilityService.instance

    override fun isAvailable(): Boolean = service != null

    override fun canHandle(command: Command): Boolean =
        service != null && command is Command.Fullscreen

    override suspend fun execute(command: Command): ExecResult = when (command) {
        is Command.Fullscreen -> enterFullscreen()
        is Command.Seek -> seekByTapping(command.deltaMs)
        else -> ExecResult.notHandled(id)
    }

    // --------------------------------------------------------------- fullscreen

    private suspend fun enterFullscreen(): ExecResult {
        val svc = service ?: return ExecResult.notHandled(id)
        val pkg = svc.foregroundPackage
        val steps = recipes.forPackage(pkg)?.fullscreen?.takeIf { it.isNotEmpty() }
            ?: recipes.fallbackFullscreen()

        for ((index, step) in steps.withIndex()) {
            val done = runStep(svc, step)
            Log.d(TAG, "step $index ${step::class.simpleName} -> $done")
            if (done) return ExecResult.ok(id, "${step::class.simpleName} on ${pkg ?: "?"}")
        }
        return ExecResult.fail(id, "Nessuna strategia ha funzionato su ${pkg ?: "app sconosciuta"}")
    }

    private suspend fun runStep(svc: RelayAccessibilityService, step: Step): Boolean =
        when (step) {
            is Step.Node -> clickMatchingNode(svc, step)
            is Step.Reveal -> {
                // A reveal never "succeeds" on its own: it exists to make the next
                // step viable, so it always reports false and falls through.
                tap(svc, step.x, step.y, double = false)
                delay(step.settleMs)
                false
            }
            is Step.Tap -> tap(svc, step.x, step.y, step.double)
            is Step.Rotate -> forceRotation(step.landscape)
            is Step.MediaSession -> false
        }

    /**
     * Depth-first search over the active window. Matches on content description
     * first (survives obfuscation and works across locales) and view id second.
     *
     * The climb matters: in both YouTube and Chromium the visible control is a
     * non-clickable ImageView wrapped in a clickable parent, so clicking the node
     * you matched does nothing at all.
     */
    private fun clickMatchingNode(svc: RelayAccessibilityService, step: Step.Node): Boolean {
        val root = svc.rootInActiveWindow ?: return false
        val wanted = step.descriptions.map { it.lowercase() }

        val match = findNode(root) { node ->
            val desc = node.contentDescription?.toString()?.lowercase()
            val viewId = node.viewIdResourceName
            (desc != null && wanted.any { desc.contains(it) }) ||
                (viewId != null && step.viewIds.any { viewId.endsWith(it) })
        } ?: return false

        var candidate: AccessibilityNodeInfo? = match
        repeat(step.climb + 1) {
            val node = candidate ?: return false
            if (node.isClickable) {
                return node.performAction(AccessibilityNodeInfo.ACTION_CLICK)
            }
            candidate = node.parent
        }
        return false
    }

    private fun findNode(
        root: AccessibilityNodeInfo,
        predicate: (AccessibilityNodeInfo) -> Boolean,
    ): AccessibilityNodeInfo? {
        if (predicate(root)) return root
        for (i in 0 until root.childCount) {
            val child = root.getChild(i) ?: continue
            findNode(child, predicate)?.let { return it }
        }
        return null
    }

    // ----------------------------------------------------------------- gestures

    private suspend fun tap(
        svc: AccessibilityService,
        nx: Float,
        ny: Float,
        double: Boolean,
    ): Boolean {
        val bounds = Rect().also {
            svc.rootInActiveWindow?.getBoundsInScreen(it)
        }
        val metrics = svc.resources.displayMetrics
        val width = if (bounds.width() > 0) bounds.width() else metrics.widthPixels
        val height = if (bounds.height() > 0) bounds.height() else metrics.heightPixels

        val path = Path().apply { moveTo(nx * width, ny * height) }
        val builder = GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(path, 0, 60))
        if (double) {
            builder.addStroke(GestureDescription.StrokeDescription(path, 160, 60))
        }

        return suspendCancellableCoroutine { cont ->
            val dispatched = svc.dispatchGesture(
                builder.build(),
                object : AccessibilityService.GestureResultCallback() {
                    override fun onCompleted(g: GestureDescription?) {
                        if (cont.isActive) cont.resume(true)
                    }
                    override fun onCancelled(g: GestureDescription?) {
                        if (cont.isActive) cont.resume(false)
                    }
                },
                null,
            )
            if (!dispatched && cont.isActive) cont.resume(false)
        }
    }

    /**
     * Fullscreen without touching the UI at all. Needs WRITE_SETTINGS, which the
     * user grants from a normal settings screen — no accessibility, no root.
     */
    private fun forceRotation(landscape: Boolean): Boolean = try {
        if (!Settings.System.canWrite(context)) {
            false
        } else {
            Settings.System.putInt(
                context.contentResolver,
                Settings.System.ACCELEROMETER_ROTATION,
                0,
            )
            Settings.System.putInt(
                context.contentResolver,
                Settings.System.USER_ROTATION,
                if (landscape) 1 else 0,
            )
            true
        }
    } catch (e: Exception) {
        Log.w(TAG, "Rotation fallback failed", e)
        false
    }

    /**
     * Last-resort seek: YouTube and most web players jump a fixed 10s per
     * double-tap, so a 30s request becomes three taps. Imprecise by nature, only
     * reached when the media session route is unavailable.
     */
    private suspend fun seekByTapping(deltaMs: Long): ExecResult {
        val svc = service ?: return ExecResult.notHandled(id)
        val taps = (kotlin.math.abs(deltaMs) / 10_000L).toInt().coerceIn(1, 12)
        val x = if (deltaMs >= 0) 0.85f else 0.15f

        repeat(taps) {
            tap(svc, x, 0.5f, double = true)
            delay(320)
        }
        return ExecResult.ok(id, "$taps double-tap da 10s (impreciso)")
    }

    private companion object {
        const val TAG = "AccessibilityExecutor"
    }
}
