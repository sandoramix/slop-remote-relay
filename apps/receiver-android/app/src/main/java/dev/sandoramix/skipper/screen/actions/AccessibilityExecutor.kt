package dev.sandoramix.skipper.screen.actions

import android.accessibilityservice.AccessibilityService
import dev.sandoramix.skipper.screen.R
import dev.sandoramix.skipper.screen.core.str
import android.accessibilityservice.GestureDescription
import android.content.Context
import android.graphics.Path
import android.graphics.Rect
import android.os.Build
import android.provider.Settings
import dev.sandoramix.skipper.screen.core.AppLog
import android.view.accessibility.AccessibilityNodeInfo
import dev.sandoramix.skipper.screen.core.Command
import dev.sandoramix.skipper.screen.core.ExecResult
import dev.sandoramix.skipper.screen.core.ExecutorId
import dev.sandoramix.skipper.screen.core.NavStatus
import dev.sandoramix.skipper.screen.recipes.BrowserNav
import dev.sandoramix.skipper.screen.recipes.BrowserStart
import dev.sandoramix.skipper.screen.recipes.PlayerStart
import dev.sandoramix.skipper.screen.recipes.PlayerState
import dev.sandoramix.skipper.screen.recipes.StartPlan
import dev.sandoramix.skipper.screen.recipes.StartStep
import dev.sandoramix.skipper.screen.recipes.NavAction
import dev.sandoramix.skipper.screen.recipes.NavPage
import dev.sandoramix.skipper.screen.recipes.NavRefusal
import dev.sandoramix.skipper.screen.recipes.Navigation
import dev.sandoramix.skipper.screen.recipes.NodeSnap
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
                childOf(node, i)?.let { stack.addLast(it to index) }
            }
        }
        return Snapshot(snaps, nodes)
    }

    /**
     * A child, asking the system to hand over the nodes below it in the same
     * round trip (Android 13+, up to 50 per call). Every plain getChild is a
     * binder call into the browser, which for a web page of a thousand nodes
     * is most of what a command costs; later children come from the cache.
     */
    private fun childOf(node: AccessibilityNodeInfo, index: Int): AccessibilityNodeInfo? =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            node.getChild(index, AccessibilityNodeInfo.FLAG_PREFETCH_DESCENDANTS_DEPTH_FIRST)
        } else {
            node.getChild(index)
        }

    /** The active window with its first nodes prefetched; null when there is none. */
    private fun rootOf(svc: AccessibilityService): AccessibilityNodeInfo? =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            svc.getRootInActiveWindow(AccessibilityNodeInfo.FLAG_PREFETCH_DESCENDANTS_DEPTH_FIRST)
        } else {
            svc.rootInActiveWindow
        }

    private fun readNav(): Pair<NavPage, Snapshot>? {
        val svc = service ?: return null
        val nav = recipes.navFor(svc.foregroundPackage) ?: return null
        val root = rootOf(svc) ?: return null
        val started = System.currentTimeMillis()
        val snap = snapshot(root)
        AppLog.v(TAG, "nav: walked ${snap.snaps.size} nodes in ${System.currentTimeMillis() - started} ms")
        return Navigation.read(nav, snap.snaps)?.let { it to snap }
    }

    /** The nav block of device.status, or null when no plan applies to what is in front. */
    fun navStatus(withItems: Boolean): NavStatus? = try {
        readNav()?.first?.status(withItems)
    } catch (e: Exception) {
        // The tree changes under our feet while a page loads; next poll will do.
        AppLog.d(TAG, "nav status unreadable", e)
        null
    }

    private suspend fun navigate(decide: (NavPage) -> NavAction): ExecResult {
        val svc = service ?: return ExecResult.notHandled(id)
        val pkg = svc.foregroundPackage ?: return ExecResult.notHandled(id)
        val nav = recipes.navFor(pkg) ?: return ExecResult.fail(id, context.str(R.string.err_nav_unavailable))
        val (page, snap) = readNav() ?: return ExecResult.fail(id, context.str(R.string.err_nav_unavailable))
        return when (val action = decide(page)) {
            is NavAction.Refuse -> ExecResult.fail(id, context.str(refusalText(action.reason)))
            is NavAction.Click -> {
                val failed = ExecResult.fail(id, context.str(R.string.err_nav_click, action.label ?: "?"))
                // Believed only once the page shows another episode or another
                // address (a link loads a new page; the site's own buttons switch
                // in-page and rewrite the address). Both within the controller's 6 s.
                val beforeUrl = Navigation.url(nav, snap.snaps)
                var landed: String? = null
                val moved: (Snapshot) -> Boolean = { s ->
                    val now = Navigation.read(nav, s.snaps)
                    val url = Navigation.url(nav, s.snaps)
                    landed = now?.current
                    (now?.current != null && now.current != page.current) ||
                        (url != null && beforeUrl != null && url != beforeUrl)
                }
                val watch = PageWatch(svc, pkg) { Navigation.foreign(nav, page.plan, it) }
                val how = press(
                    svc, snap.nodes[action.node], climb = 0, watch,
                    until = System.currentTimeMillis() + NAV_WATCH_MS, effect = moved, order = recipes.pressOrderFor(pkg),
                ) ?: return failed
                ExecResult.ok(id, "${page.plan.site}: ${action.label ?: landed ?: "?"} ($how)")
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

    // ---------------------------------------------------------- verified press

    /**
     * Watches the browser after a press. A tab the site's ad script opened in
     * front ([foreign]: an address the plan does not cover) or another app
     * brought forward is closed with Back, at most [MAX_BACKS] times per
     * command: Chrome closes a popup tab on Back and returns to its opener.
     */
    private inner class PageWatch(
        val svc: RelayAccessibilityService,
        val pkg: String,
        val foreign: (List<NodeSnap>) -> Boolean,
    ) {
        /** A popup showed up since [reset]: the page took the press, whatever came of it. */
        var popupSeen = false
        private var backs = 0

        fun reset() { popupSeen = false }

        /** Polls until [effect] holds on our page (true) or [until] passes (false). */
        suspend fun await(until: Long, effect: (Snapshot) -> Boolean): Boolean {
            while (System.currentTimeMillis() < until) {
                delay(POLL_MS)
                try {
                    val front = svc.foregroundPackage
                    val snap = snapshot(rootOf(svc) ?: continue)
                    if ((front != null && front != pkg) || foreign(snap.snaps)) {
                        popupSeen = true
                        if (backs < MAX_BACKS) {
                            AppLog.d(TAG, "press: popup in front (${front ?: "?"}), pressing Back")
                            svc.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK)
                            backs++
                            delay(POPUP_SETTLE_MS)
                        }
                        continue
                    }
                    if (effect(snap)) return true
                } catch (e: Exception) {
                    AppLog.d(TAG, "press: tree changed while watching", e) // a page loading
                }
            }
            return false
        }
    }

    /**
     * Presses a web element and believes it only when [effect] shows on the page.
     *
     * The methods are tried in [order] (recipes.json `press`, per browser;
     * default click then tap). Chrome runs a web element's default action on
     * ACTION_CLICK, on screen or not. Brave 1.97 accepts the same action and
     * does nothing (links, buttons, a player cover and its play button), while
     * a real tap on the element works; so a method whose effect does not show
     * within [PRESS_VERIFY_MS] is followed by the next.
     *
     * A popup after a press means the page took it and its ad script may have
     * swallowed it (seen on Chrome with the site's own button): the same method
     * is repeated once before moving on, so a slow but real press is less
     * likely to be doubled by the next method. Still nothing, and the next
     * method is tried: on Chrome a click on AnimeWorld's player cover opens the
     * popup every time and never the player, which only a tap starts.
     *
     * Returns the method that worked ("click", "tap", "click again"...), or
     * null when nothing showed by [until].
     */
    private suspend fun press(
        svc: RelayAccessibilityService,
        node: AccessibilityNodeInfo,
        climb: Int,
        watch: PageWatch,
        until: Long,
        effect: (Snapshot) -> Boolean,
        order: List<String>,
    ): String? {
        for ((i, method) in order.withIndex()) {
            if (System.currentTimeMillis() >= until) break
            watch.reset()
            if (!performPress(svc, node, climb, method)) {
                AppLog.d(TAG, "press: $method not possible")
                continue
            }
            val last = i == order.lastIndex
            val wait = if (last) until else minOf(until, System.currentTimeMillis() + PRESS_VERIFY_MS)
            val pressedAt = System.currentTimeMillis()
            if (watch.await(wait, effect)) {
                AppLog.d(TAG, "press: $method took effect after ${System.currentTimeMillis() - pressedAt} ms")
                return method
            }
            if (watch.popupSeen) {
                AppLog.d(TAG, "press: $method opened a popup and nothing else, once more")
                val again = if (last) until else minOf(until, System.currentTimeMillis() + PRESS_VERIFY_MS)
                if (node.refresh() && performPress(svc, node, climb, method) && watch.await(again, effect)) {
                    return "$method again"
                }
            }
            AppLog.d(TAG, "press: $method showed no effect")
        }
        return null
    }

    private suspend fun performPress(
        svc: RelayAccessibilityService,
        node: AccessibilityNodeInfo,
        climb: Int,
        method: String,
    ): Boolean = when (method) {
        "click" -> accessibilityClick(node, climb)
        "tap" -> tapNode(svc, node)
        else -> false
    }

    /** ACTION_CLICK on the node, then on up to [climb] ancestors. */
    private fun accessibilityClick(node: AccessibilityNodeInfo, climb: Int): Boolean {
        if (node.performAction(AccessibilityNodeInfo.ACTION_CLICK)) return true
        var up = node.parent
        for (level in 1..climb) {
            val n = up ?: break
            if (n.performAction(AccessibilityNodeInfo.ACTION_CLICK)) return true
            up = n.parent
        }
        return false
    }

    /**
     * A real tap at the node's centre, a user gesture beyond doubt. A node off
     * screen (episode links outside the visible list have bounds [0,0][0,0]) is
     * scrolled into view first; one that stays off screen cannot be tapped.
     */
    private suspend fun tapNode(svc: RelayAccessibilityService, node: AccessibilityNodeInfo): Boolean {
        if (!node.refresh()) return false
        val screen = Rect().also { svc.rootInActiveWindow?.getBoundsInScreen(it) }
        fun bounds() = Rect().also { node.getBoundsInScreen(it) }
        fun onScreen(r: Rect) = !r.isEmpty && (screen.isEmpty || screen.contains(r.centerX(), r.centerY()))
        var r = bounds()
        if (!onScreen(r) || !node.isVisibleToUser) {
            node.performAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_SHOW_ON_SCREEN.id)
            delay(SCROLL_SETTLE_MS)
            node.refresh()
            r = bounds()
        }
        if (!onScreen(r)) {
            AppLog.d(TAG, "press: node not on screen ($r)")
            return false
        }
        return tapAt(svc, r.exactCenterX(), r.exactCenterY(), double = false)
    }

    // ------------------------------------------------------------ player start

    /**
     * Before a command that needs a player (play, seek, fullscreen.enter): when
     * the browser in front shows a page whose `start` plan says the player is
     * not loaded yet, press the page's start control and wait, bounded, for the
     * player to appear. A play command is then answered here, after pressing the
     * loaded player's own play button when the plan names one, because running
     * a toggle on top of that would pause it again. Every other command runs
     * after, with a note in its ack.
     *
     * Judged on the page's tree only, never on media sessions (see
     * PlayerStart.decide); costs one tree walk, only on a browser with a plan.
     */
    suspend fun ensurePlayer(command: Command): Prepared {
        if (!PlayerStart.wantsPlayer(command)) return Prepared.Ready
        val svc = service ?: return Prepared.Ready
        val pkg = svc.foregroundPackage ?: return Prepared.Ready
        val start = recipes.startFor(pkg) ?: return Prepared.Ready
        val bar = recipes.urlBarFor(pkg)
        val snap = try {
            snapshot(rootOf(svc) ?: return Prepared.Ready)
        } catch (e: Exception) {
            AppLog.d(TAG, "start: tree unreadable", e)
            return Prepared.Ready
        }

        return when (val step = PlayerStart.decide(command, start, bar, snap.snaps)) {
            StartStep.Proceed -> Prepared.Ready
            is StartStep.ControlMissing ->
                Prepared.Answer(ExecResult.fail(id, context.str(R.string.err_start_no_control, step.plan.site)))
            is StartStep.ClickPlay -> {
                val plan = step.plan
                val watch = PageWatch(svc, pkg) { PlayerStart.foreign(bar, plan, it) }
                val how = pressPlay(svc, start, bar, plan, watch, snap.nodes[step.node], pkg)
                    ?: return Prepared.Answer(ExecResult.fail(id, context.str(R.string.err_start_click, plan.site)))
                Prepared.Answer(ExecResult.ok(id, context.str(R.string.start_playback, plan.site) + " ($how)"))
            }
            is StartStep.ClickControl -> startPlayer(svc, command, start, bar, pkg, step, snap)
        }
    }

    private suspend fun startPlayer(
        svc: RelayAccessibilityService,
        command: Command,
        start: BrowserStart,
        bar: List<String>,
        pkg: String,
        step: StartStep.ClickControl,
        snap: Snapshot,
    ): Prepared {
        val plan = step.plan
        val pressed = System.currentTimeMillis()
        val watch = PageWatch(svc, pkg) { PlayerStart.foreign(bar, plan, it) }
        // Judge only a window the plan applies to: our page, not a popup over it.
        val started: (Snapshot) -> Boolean = { s ->
            PlayerStart.plan(start, bar, s.snaps) == plan && PlayerStart.state(plan, s.snaps) == PlayerState.STARTED
        }
        val how = press(
            svc, snap.nodes[step.node], plan.climb, watch,
            until = pressed + plan.waitMs, effect = started, order = plan.press ?: recipes.pressOrderFor(pkg),
        )
        AppLog.d(TAG, "start: ${plan.site} control -> ${how ?: "no player"} in ${System.currentTimeMillis() - pressed} ms")
        if (how == null) return Prepared.Answer(ExecResult.fail(id, context.str(R.string.err_start_timeout, plan.site)))

        // A popup opens a moment after the press; give it that moment (and
        // close it) before handing the page to a command, unless it came already.
        if (!watch.popupSeen) watch.await(pressed + POPUP_GRACE_MS) { false }

        if (!PlayerStart.wantsPlayback(command) || plan.play == null) {
            return if (PlayerStart.wantsPlayback(command)) {
                Prepared.Answer(ExecResult.ok(id, context.str(R.string.start_started, plan.site) + " ($how)"))
            } else {
                Prepared.Started(context.str(R.string.start_started, plan.site) + " ($how)")
            }
        }
        // The player's frame may still be loading: wait for its play button.
        var playNode: AccessibilityNodeInfo? = null
        watch.await(System.currentTimeMillis() + PLAY_APPEAR_MS) { s ->
            PlayerStart.find(plan.play, s.snaps)?.let { playNode = s.nodes[it] } != null
        }
        val played = playNode?.let { pressPlay(svc, start, bar, plan, watch, it, pkg) }
        AppLog.d(TAG, "start: play button -> ${played ?: "not pressed"}")
        val text = if (played != null) R.string.start_started_playing else R.string.start_started
        return Prepared.Answer(ExecResult.ok(id, context.str(text, plan.site) + " ($how${played?.let { ", $it" } ?: ""})"))
    }

    /** Presses the loaded player's play button; believed once the button no longer says play. */
    private suspend fun pressPlay(
        svc: RelayAccessibilityService,
        start: BrowserStart,
        bar: List<String>,
        plan: StartPlan,
        watch: PageWatch,
        node: AccessibilityNodeInfo,
        pkg: String,
    ): String? = press(
        svc, node, climb = 0, watch,
        until = System.currentTimeMillis() + PLAY_WAIT_MS,
        effect = { s -> PlayerStart.plan(start, bar, s.snaps) == plan && PlayerStart.find(plan.play, s.snaps) == null },
        order = recipes.pressOrderFor(pkg),
    )

    // --------------------------------------------------------------- fullscreen

    /**
     * Best guess at whether the foreground player is fullscreen, from the
     * recipe's markers: an "exit full screen" control in the tree, or a browser
     * whose URL bar has vanished. Null when there is no window to look at.
     */
    fun isFullscreen(): Boolean? {
        val svc = service ?: return null
        val root = rootOf(svc) ?: return null
        val markers = recipes.forPackage(svc.foregroundPackage)?.markers
            ?: recipes.fallbackMarkers()

        val wanted = markers.present.map { it.lowercase() }
        // One walk for both signals: a marker ends it (fullscreen), a visible
        // bar is noted on the way. Two walks used to cost twice the binder calls.
        var barPresent = false
        val marker = findNode(root) { node ->
            if (!barPresent && markers.absentViewIds.isNotEmpty()) {
                val viewId = node.viewIdResourceName
                // Chromium keeps the toolbar in the tree while hiding it, so
                // only a visible bar means "not fullscreen".
                barPresent = viewId != null && node.isVisibleToUser && markers.absentViewIds.any { viewId.endsWith(it) }
            }
            wanted.isNotEmpty() && labelMatches(node, wanted)
        }
        return when {
            marker != null -> true
            markers.absentViewIds.isNotEmpty() -> !barPresent
            else -> false
        }
    }

    private suspend fun enterFullscreen(): ExecResult {
        val svc = service ?: return ExecResult.notHandled(id)
        val pkg = svc.foregroundPackage
        val steps = recipes.forPackage(pkg)?.fullscreen?.takeIf { it.isNotEmpty() }
            ?: recipes.fallbackFullscreen()

        // A click can be accepted and still not produce fullscreen: Chromium
        // does not always treat an accessibility click as a user activation.
        // So a Node step is judged by the markers, not by its return value.
        // Polled rather than waited out: the transition usually finishes well
        // inside VERIFY_MS, and a fixed wait made every enter cost the full time.
        val verify: suspend () -> Boolean = {
            val deadline = System.currentTimeMillis() + VERIFY_MS
            var state: Boolean?
            do {
                delay(VERIFY_POLL_MS)
                state = isFullscreen()
            } while (state == false && System.currentTimeMillis() < deadline)
            state != false
        }
        val begun = System.currentTimeMillis()
        for ((index, step) in steps.withIndex()) {
            val done = if (step is Step.Node) clickMatchingNode(svc, step, verify) else runStep(svc, step)
            AppLog.d(TAG, "step $index ${step::class.simpleName} -> $done (${System.currentTimeMillis() - begun} ms)")
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
            AppLog.d(TAG, "exit step $index ${step::class.simpleName} -> $done")
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
        val root = rootOf(svc) ?: return false
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
        // One walk: stops at the first visible match, remembering the first
        // match of any kind in case none is visible.
        var faded: AccessibilityNodeInfo? = null
        val visible = findNode(root) { node ->
            matches(node) && (node.isVisibleToUser || run { if (faded == null) faded = node; false })
        }
        val match = visible ?: faded ?: return false

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
            val child = childOf(root, i) ?: continue
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
        AppLog.w(TAG, "Rotation fallback failed", e)
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
        const val VERIFY_MS = 1_200L

        /** How often the fullscreen state is looked at while waiting for it. */
        const val VERIFY_POLL_MS = 100L

        /** Enough for any page we have seen; the walk stops here rather than run away. */
        const val MAX_NODES = 6000

        const val SCROLL_SETTLE_MS = 400L

        /** How long a navigation press gets to move the page; the controller gives up on an ack at 6 s. */
        const val NAV_WATCH_MS = 4_500L

        /** How long one press method gets to show its effect before the next method is tried. */
        const val PRESS_VERIFY_MS = 2_000L

        /** Popups closed with Back per command, at most. */
        const val MAX_BACKS = 2

        /** After the player appeared, how long its play button gets to appear (its frame loading). */
        const val PLAY_APPEAR_MS = 1_500L

        /** How long a press on the player's play button gets to show. */
        const val PLAY_WAIT_MS = 3_000L

        /** After Back closes a popup, before the page underneath is read again. */
        const val POPUP_SETTLE_MS = 500L

        const val POLL_MS = 150L

        /** After a start click, how long a popup is waited for before the page is handed to a command. */
        const val POPUP_GRACE_MS = 1_200L
    }
}
