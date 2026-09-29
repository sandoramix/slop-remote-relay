package dev.sandoramix.skipper.screen.actions

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.content.Context
import android.graphics.Path
import android.graphics.Rect
import android.os.Build
import android.provider.Settings
import android.util.Log
import android.view.accessibility.AccessibilityNodeInfo
import dev.sandoramix.skipper.screen.core.Command
import dev.sandoramix.skipper.screen.core.ExecResult
import dev.sandoramix.skipper.screen.core.ExecutorId
import dev.sandoramix.skipper.screen.recipes.RecipeEngine
import dev.sandoramix.skipper.screen.recipes.Step
import dev.sandoramix.skipper.screen.service.RelayAccessibilityService
import kotlinx.coroutines.delay
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume

/**
 * The main route to fullscreen, and the fallback for everything else.
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

    /**
     * Seek is included on purpose. MediaSession sits ahead of this executor in
     * the chain and will take any seek it can, so the only way to reach here with
     * one is that notification access is missing or the app publishes no session
     * — which is exactly when the coarse tap fallback earns its keep. Leaving
     * seek out made ExecutorChain answer "no executor available" instead.
     */
    override fun canHandle(command: Command): Boolean = when (command) {
        is Command.Fullscreen, is Command.FullscreenExit, is Command.Seek -> service != null
        else -> false
    }

    override suspend fun execute(command: Command): ExecResult = when (command) {
        is Command.Fullscreen ->
            if (command.toggle && isFullscreen() == true) exitFullscreen() else enterFullscreen()
        is Command.FullscreenExit -> exitFullscreen()
        is Command.Seek -> seekByTapping(command.deltaMs)
        else -> ExecResult.notHandled(id)
    }

    // --------------------------------------------------------------- fullscreen

    /**
     * Best guess at whether the foreground player is fullscreen, from the
     * recipe's markers: an "exit full screen" control in the tree, or a browser
     * whose URL bar has vanished. Null when there is no window to look at.
     */
    fun isFullscreen(): Boolean? {
        val svc = service ?: return null
        val root = svc.rootInActiveWindow ?: return null
        val markers = recipes.forPackage(svc.foregroundPackage)?.markers
            ?: recipes.fallbackMarkers()

        val wanted = markers.present.map { it.lowercase() }
        if (wanted.isNotEmpty() && findNode(root) { labelMatches(it, wanted) } != null) {
            return true
        }
        if (markers.absentViewIds.isNotEmpty()) {
            val barPresent = findNode(root) { node ->
                val viewId = node.viewIdResourceName
                // Chromium keeps the toolbar in the tree while hiding it, so
                // only a visible bar means "not fullscreen".
                viewId != null && node.isVisibleToUser && markers.absentViewIds.any { viewId.endsWith(it) }
            } != null
            return !barPresent
        }
        return false
    }

    private suspend fun enterFullscreen(): ExecResult {
        val svc = service ?: return ExecResult.notHandled(id)
        val pkg = svc.foregroundPackage
        val steps = recipes.forPackage(pkg)?.fullscreen?.takeIf { it.isNotEmpty() }
            ?: recipes.fallbackFullscreen()

        // A click can be accepted and still not produce fullscreen: Chromium
        // does not always treat an accessibility click as a user activation.
        // So a Node step is judged by the markers, not by its return value.
        val verify: suspend () -> Boolean = {
            delay(VERIFY_MS)
            isFullscreen() != false
        }
        for ((index, step) in steps.withIndex()) {
            val done = if (step is Step.Node) clickMatchingNode(svc, step, verify) else runStep(svc, step)
            Log.d(TAG, "step $index ${step::class.simpleName} -> $done")
            if (done) return ExecResult.ok(id, "${step::class.simpleName} on ${pkg ?: "?"}")
        }
        return ExecResult.fail(id, "Nessuna strategia ha funzionato su ${pkg ?: "app sconosciuta"}")
    }

    private suspend fun exitFullscreen(): ExecResult {
        val svc = service ?: return ExecResult.notHandled(id)
        val pkg = svc.foregroundPackage
        // Back outside fullscreen would navigate away from the video, so only
        // press it when the markers say there is something to leave.
        if (isFullscreen() == false) return ExecResult.ok(id, "già fuori dallo schermo intero")

        val steps = recipes.forPackage(pkg)?.exitFullscreen?.takeIf { it.isNotEmpty() }
            ?: recipes.fallbackExitFullscreen()

        for ((index, step) in steps.withIndex()) {
            val done = runStep(svc, step)
            Log.d(TAG, "exit step $index ${step::class.simpleName} -> $done")
            if (done) return ExecResult.ok(id, "exit ${step::class.simpleName} on ${pkg ?: "?"}")
        }
        return ExecResult.fail(id, "Impossibile uscire dallo schermo intero su ${pkg ?: "app sconosciuta"}")
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
            is Step.Back -> svc.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK)
            is Step.MediaSession -> false
            // Injecting a key into another app needs Shizuku; not ours to do.
            is Step.Key -> false
        }

    /**
     * Depth-first search over the active window, matching a node's label — its
     * text, content description, tooltip or hint — and then its view id.
     *
     * The label has to cover all four, not just the content description. Native
     * apps like YouTube label icon buttons with a content description, but
     * Chromium (Chrome, Brave, any WebView) maps a web control's accessible name,
     * aria-label included, onto the node's text. Matching the description alone
     * is why the fullscreen button of a web player was invisible to this code.
     *
     * The climb matters too: in both YouTube and Chromium the visible control is
     * often a non-clickable view wrapped in a clickable parent, so clicking the
     * node you matched does nothing at all.
     *
     * When no ancestor accepts ACTION_CLICK the node is tapped with a real
     * gesture at its centre. A web page only enters fullscreen inside a user
     * activation, and a dispatched touch is one beyond any doubt.
     */
    private suspend fun clickMatchingNode(
        svc: RelayAccessibilityService,
        step: Step.Node,
        verify: (suspend () -> Boolean)? = null,
    ): Boolean {
        val root = svc.rootInActiveWindow ?: return false
        val wanted = step.descriptions.map { it.lowercase() }

        val matches: (AccessibilityNodeInfo) -> Boolean = { node ->
            val viewId = node.viewIdResourceName
            labelMatches(node, wanted) ||
                (viewId != null && step.viewIds.any { viewId.endsWith(it) })
        }
        // A visible match first. Web players fade their controls out while
        // keeping them in the tree, and a reveal tap can fade them out as easily
        // as in, so a faded match is still worth an ACTION_CLICK: Chromium runs
        // the element's default action whatever its opacity.
        val visible = findNode(root) { matches(it) && it.isVisibleToUser }
        val match = visible ?: findNode(root, matches) ?: return false

        var candidate: AccessibilityNodeInfo? = match
        for (level in 0..step.climb) {
            val node = candidate ?: break
            if (node.isClickable && node.performAction(AccessibilityNodeInfo.ACTION_CLICK)) {
                if (verify == null || verify()) return true
                break // accepted but ineffective: fall through to a real tap
            }
            candidate = node.parent
        }

        // A gesture only where the control can actually be seen: a blind tap
        // on a faded control just toggles the overlay.
        if (visible == null) return false
        val bounds = Rect().also { match.getBoundsInScreen(it) }
        if (bounds.isEmpty) return false
        if (!tapAt(svc, bounds.exactCenterX(), bounds.exactCenterY(), double = false)) return false
        return verify?.invoke() ?: true
    }

    private fun labelMatches(node: AccessibilityNodeInfo, wanted: List<String>): Boolean {
        if (wanted.isEmpty()) return false
        val labels = buildList {
            node.contentDescription?.let { add(it) }
            node.text?.let { add(it) }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) node.tooltipText?.let { add(it) }
            node.hintText?.let { add(it) }
        }
        return labels.any { label ->
            val lower = label.toString().lowercase()
            wanted.any { lower.contains(it) }
        }
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

    /** Tap at a coordinate normalised to the active window. */
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
        return tapAt(svc, nx * width, ny * height, double)
    }

    /** Tap at an absolute screen coordinate. */
    private suspend fun tapAt(
        svc: AccessibilityService,
        x: Float,
        y: Float,
        double: Boolean,
    ): Boolean {
        val path = Path().apply { moveTo(x, y) }
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
     * double-tap, so a 30s request becomes three taps. Imprecise by nature, and
     * only reached when the media session route is unavailable.
     *
     * Driven by the `seek` list in recipes.json, same as fullscreen. A recipe's
     * tap coordinate describes the forward side of the player; a rewind mirrors
     * it across the screen rather than needing a second entry.
     */
    private suspend fun seekByTapping(deltaMs: Long): ExecResult {
        val svc = service ?: return ExecResult.notHandled(id)
        val pkg = svc.foregroundPackage
        val steps = recipes.forPackage(pkg)?.seek?.takeIf { it.isNotEmpty() }
            ?: recipes.fallbackSeek()

        for (step in steps) {
            when (step) {
                // MediaSession is ahead of this executor in the chain, so by the
                // time we are here it has already declined. The step stays in the
                // recipe as a record of the preferred order.
                is Step.MediaSession -> Unit

                is Step.Tap -> {
                    // No ceiling: the controller lets the user pick any amount.
                    // A long jump is slow here, one double-tap per 10 s, but it
                    // lands close to where it was asked; MediaSession is the fast path.
                    val taps = ((kotlin.math.abs(deltaMs) + SEEK_STEP_MS / 2) / SEEK_STEP_MS)
                        .toInt().coerceAtLeast(1)
                    val x = if (deltaMs >= 0) step.x else 1f - step.x
                    repeat(taps) {
                        tap(svc, x, step.y, step.double)
                        delay(TAP_SETTLE_MS)
                    }
                    return ExecResult.ok(
                        id,
                        "$taps tap da ${SEEK_STEP_MS / 1000}s su ${pkg ?: "?"} (impreciso)",
                    )
                }

                is Step.Reveal -> {
                    tap(svc, step.x, step.y, double = false)
                    delay(step.settleMs)
                }

                is Step.Node -> if (clickMatchingNode(svc, step)) {
                    return ExecResult.ok(id, "Node on ${pkg ?: "?"}")
                }

                // None of these move the playhead.
                is Step.Rotate, is Step.Back, is Step.Key -> Unit
            }
        }
        return ExecResult.fail(id, "Nessuna strategia di seek su ${pkg ?: "app sconosciuta"}")
    }

    private companion object {
        const val TAG = "AccessibilityExecutor"

        /** What one double-tap is worth in YouTube and in every web player we target. */
        const val SEEK_STEP_MS = 10_000L

        /** Long enough for the player to register the previous tap as a separate one. */
        const val TAP_SETTLE_MS = 320L

        /** How long a player gets to enter fullscreen before a step is judged. */
        const val VERIFY_MS = 700L
    }
}
