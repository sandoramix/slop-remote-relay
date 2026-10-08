package com.relay.receiver.actions

import android.accessibilityservice.AccessibilityService
import com.relay.receiver.R
import com.relay.receiver.core.str
import android.accessibilityservice.GestureDescription
import android.content.Context
import android.graphics.Path
import android.graphics.Rect
import android.os.Build
import android.provider.Settings
import android.util.Log
import android.view.accessibility.AccessibilityNodeInfo
import com.relay.receiver.core.Command
import com.relay.receiver.core.ExecResult
import com.relay.receiver.core.ExecutorId
import com.relay.receiver.core.NavStatus
import com.relay.receiver.recipes.BrowserNav
import com.relay.receiver.recipes.NavPlan
import com.relay.receiver.recipes.NavAction
import com.relay.receiver.recipes.NavPage
import com.relay.receiver.recipes.NavRefusal
import com.relay.receiver.recipes.Navigation
import com.relay.receiver.recipes.NodeSnap
import com.relay.receiver.recipes.RecipeEngine
import com.relay.receiver.recipes.Step
import com.relay.receiver.service.RelayAccessibilityService
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
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

    /** For work that outlives a command's ack (closing a popup after a navigation). */
    private val background = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    /**
     * Seek is included on purpose. MediaSession sits ahead of this executor in
     * the chain and will take any seek it can, so the only way to reach here with
     * one is that notification access is missing or the app publishes no session
     * — which is exactly when the coarse tap fallback earns its keep. Leaving
     * seek out made ExecutorChain answer "no executor available" instead.
     */
    override fun canHandle(command: Command): Boolean = when (command) {
        is Command.Fullscreen, is Command.FullscreenExit, is Command.Seek,
        is Command.NavStep, is Command.NavGoto -> service != null
        else -> false
    }

    override suspend fun execute(command: Command): ExecResult = when (command) {
        is Command.Fullscreen ->
            if (command.toggle && isFullscreen() == true) exitFullscreen() else enterFullscreen()
        is Command.FullscreenExit -> exitFullscreen()
        is Command.Seek -> seekByTapping(command.deltaMs)
        is Command.NavStep -> navigate { Navigation.step(it, command.delta) }
        is Command.NavGoto -> navigate { Navigation.goto(it, command.index, command.label) }
        else -> ExecResult.notHandled(id)
    }

    // --------------------------------------------------------------- navigation

    /** The window flattened for Navigation, with the live nodes alongside. */
    private class Snapshot(val snaps: List<NodeSnap>, val nodes: List<AccessibilityNodeInfo>)

    private fun snapshot(root: AccessibilityNodeInfo): Snapshot {
        val snaps = ArrayList<NodeSnap>()
        val nodes = ArrayList<AccessibilityNodeInfo>()
        // Iterative depth-first walk; a long series puts thousands of nodes in
        // Chrome's tree, too deep a recursion for comfort.
        val stack = ArrayDeque<Pair<AccessibilityNodeInfo, Int>>()
        stack.addLast(root to -1)
        while (stack.isNotEmpty() && snaps.size < MAX_NODES) {
            val (node, parent) = stack.removeLast()
            val index = snaps.size
            snaps += NodeSnap(
                parent = parent,
                className = node.className?.toString(),
                viewId = node.viewIdResourceName,
                text = node.text?.toString(),
                desc = node.contentDescription?.toString(),
                clickable = node.isClickable,
            )
            nodes += node
            for (i in node.childCount - 1 downTo 0) {
                node.getChild(i)?.let { stack.addLast(it to index) }
            }
        }
        return Snapshot(snaps, nodes)
    }

    private fun readNav(): Pair<NavPage, Snapshot>? {
        val svc = service ?: return null
        val nav = recipes.navFor(svc.foregroundPackage) ?: return null
        val root = svc.rootInActiveWindow ?: return null
        val started = System.currentTimeMillis()
        val snap = snapshot(root)
        Log.v(TAG, "nav: walked ${snap.snaps.size} nodes in ${System.currentTimeMillis() - started} ms")
        return Navigation.read(nav, snap.snaps)?.let { it to snap }
    }

    /** The nav block of device.status, or null when no plan applies to what is in front. */
    fun navStatus(withItems: Boolean): NavStatus? = try {
        readNav()?.first?.status(withItems)
    } catch (e: Exception) {
        // The tree changes under our feet while a page loads; next poll will do.
        Log.d(TAG, "nav status unreadable", e)
        null
    }

    private suspend fun navigate(decide: (NavPage) -> NavAction): ExecResult {
        val svc = service ?: return ExecResult.notHandled(id)
        val pkg = svc.foregroundPackage
        val nav = recipes.navFor(pkg)
        val (page, snap) = readNav() ?: return ExecResult.fail(id, context.str(R.string.err_nav_unavailable))
        return when (val action = decide(page)) {
            is NavAction.Refuse -> ExecResult.fail(id, context.str(refusalText(action.reason)))
            is NavAction.Click -> {
                val failed = ExecResult.fail(id, context.str(R.string.err_nav_click, action.label ?: "?"))
                val how = clickNode(svc, snap.nodes[action.node]) ?: return failed
                val done = ExecResult.ok(id, "${page.plan.site}: ${action.label ?: "?"} ($how)")
                if (nav == null || pkg == null) return done

                if (!action.viaButton) {
                    // A link navigates on its own, popup or not: answer now, while
                    // the page reloads, and tidy up the popup behind the answer.
                    background.launch { watch(svc, nav, page.plan, pkg, before = null, forMs = POPUP_WATCH_MS) }
                    return done
                }
                // The site's button can be swallowed by its ad popup: believe it
                // only once the episode changes, and press it once more after a
                // popup has been closed. All inside the controller's 6 s.
                var retried = false
                val moved = watch(svc, nav, page.plan, pkg, before = page.current, forMs = BUTTON_WATCH_MS) {
                    if (!retried) {
                        retried = true
                        delay(POPUP_SETTLE_MS)
                        readNav()?.takeIf { it.first.current == page.current }?.let { (again, snapAgain) ->
                            (decide(again) as? NavAction.Click)?.let { clickNode(svc, snapAgain.nodes[it.node]) }
                        }
                    }
                }
                when {
                    moved -> done
                    // The page is still loading, or the second press was swallowed
                    // too; the status will tell within seconds.
                    retried -> ExecResult.ok(id, "${page.plan.site}: ? ($how, unverified)")
                    else -> failed
                }
            }
        }
    }

    private fun refusalText(reason: NavRefusal): Int = when (reason) {
        NavRefusal.UNKNOWN_CURRENT -> R.string.err_nav_unknown_current
        NavRefusal.AT_FIRST -> R.string.err_nav_at_first
        NavRefusal.AT_LAST -> R.string.err_nav_at_last
        NavRefusal.OTHER_RANGE -> R.string.err_nav_other_range
        NavRefusal.LIST_CHANGED -> R.string.err_nav_list_changed
    }

    /**
     * ACTION_CLICK first. Chromium runs a web element's default action whether
     * or not the element is on screen or marked clickable: an episode link with
     * bounds [0,0][0,0] and the site's non-clickable "Precedente" text both took
     * it on the emulator. Only a refused click falls back to scrolling the node
     * into view and tapping it.
     */
    private suspend fun clickNode(svc: RelayAccessibilityService, node: AccessibilityNodeInfo): String? {
        if (node.performAction(AccessibilityNodeInfo.ACTION_CLICK)) return "click"
        node.performAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_SHOW_ON_SCREEN.id)
        delay(SCROLL_SETTLE_MS)
        node.refresh()
        val bounds = Rect().also { node.getBoundsInScreen(it) }
        if (bounds.isEmpty || !tapAt(svc, bounds.exactCenterX(), bounds.exactCenterY(), double = false)) {
            Log.d(TAG, "nav: node neither clickable nor tappable ($bounds)")
            return null
        }
        return "tap"
    }

    /**
     * Watches the browser for [forMs] after a click. A tab the site's ad script
     * opened in front (an address the plan does not cover) or another app
     * brought forward is closed with Back, once: Chrome closes a popup tab on
     * Back and returns to the page that opened it. [onPopupClosed] runs after.
     *
     * With [before] set, returns true as soon as the page shows an episode other
     * than [before]. Without it, returns once a popup has been closed, or at the
     * deadline.
     */
    private suspend fun watch(
        svc: RelayAccessibilityService,
        nav: BrowserNav,
        plan: NavPlan,
        pkg: String,
        before: String?,
        forMs: Long,
        onPopupClosed: suspend () -> Unit = {},
    ): Boolean {
        var closed = false
        val deadline = System.currentTimeMillis() + forMs
        while (System.currentTimeMillis() < deadline) {
            delay(POLL_MS)
            try {
                val root = svc.rootInActiveWindow ?: continue
                val front = svc.foregroundPackage
                val snaps = snapshot(root).snaps
                val popup = (front != null && front != pkg) || Navigation.foreign(nav, plan, snaps)
                if (popup && !closed) {
                    Log.d(TAG, "nav: popup in front (${front ?: "?"}, ${Navigation.url(nav, snaps)?.take(80)}), pressing Back")
                    svc.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK)
                    closed = true
                    onPopupClosed()
                    if (before == null) return false
                    continue
                }
                if (before != null) {
                    val now = Navigation.read(nav, snaps)?.current
                    if (now != null && now != before) return true
                }
            } catch (e: Exception) {
                Log.d(TAG, "nav: tree changed while watching", e) // a page loading
            }
        }
        if (before != null) Log.d(TAG, "nav: the page did not move from $before")
        return false
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
        return ExecResult.fail(id, context.str(R.string.err_no_strategy, pkg ?: context.str(R.string.unknown_app)))
    }

    private suspend fun exitFullscreen(): ExecResult {
        val svc = service ?: return ExecResult.notHandled(id)
        val pkg = svc.foregroundPackage
        // Back outside fullscreen would navigate away from the video, so only
        // press it when the markers say there is something to leave.
        if (isFullscreen() == false) return ExecResult.ok(id, context.str(R.string.err_already_windowed))

        val steps = recipes.forPackage(pkg)?.exitFullscreen?.takeIf { it.isNotEmpty() }
            ?: recipes.fallbackExitFullscreen()

        for ((index, step) in steps.withIndex()) {
            val done = runStep(svc, step)
            Log.d(TAG, "exit step $index ${step::class.simpleName} -> $done")
            if (done) return ExecResult.ok(id, "exit ${step::class.simpleName} on ${pkg ?: "?"}")
        }
        return ExecResult.fail(id, context.str(R.string.err_cannot_exit, pkg ?: context.str(R.string.unknown_app)))
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
        return ExecResult.fail(id, context.str(R.string.err_no_seek_strategy, pkg ?: context.str(R.string.unknown_app)))
    }

    private companion object {
        const val TAG = "AccessibilityExecutor"

        /** What one double-tap is worth in YouTube and in every web player we target. */
        const val SEEK_STEP_MS = 10_000L

        /** Long enough for the player to register the previous tap as a separate one. */
        const val TAP_SETTLE_MS = 320L

        /** How long a player gets to enter fullscreen before a step is judged. */
        const val VERIFY_MS = 700L

        /** Enough for any page we have seen; the walk stops here rather than run away. */
        const val MAX_NODES = 6000

        const val SCROLL_SETTLE_MS = 400L

        /** How long after a link click a popup is watched for. */
        const val POPUP_WATCH_MS = 6_000L

        /** How long a site button gets to move the page; the controller gives up on an ack at 6 s. */
        const val BUTTON_WATCH_MS = 4_500L

        /** After Back closes a popup, before the page underneath is read again. */
        const val POPUP_SETTLE_MS = 500L

        const val POLL_MS = 300L
    }
}
