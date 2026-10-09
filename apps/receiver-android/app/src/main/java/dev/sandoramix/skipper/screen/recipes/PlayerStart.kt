package dev.sandoramix.skipper.screen.recipes

import dev.sandoramix.skipper.screen.core.Command

/**
 * Starting a web player that only appears after the visitor clicks the page.
 *
 * Some sites (AnimeWorld) show a cover image where the player will be, and load
 * the player only on a click. Until then there is no video and no media session,
 * so play/pause, seek and fullscreen have nothing to act on. A `start` plan
 * (recipes.json, under a browser package, next to `nav`) says how to recognise
 * such a page, what to click, and how to tell that the player is there.
 *
 * Same split as Navigation: this file decides on plain [NodeSnap]s, the
 * executor flattens the tree and clicks. Nothing here names a site.
 */

/**
 * Picks nodes out of a flattened window. Every non-empty list must match
 * (lists left empty are ignored); an empty matcher matches nothing.
 */
data class NodeMatcher(
    /**
     * viewIdResourceName. A bare id ("player-cover", how Chromium reports an
     * HTML id) must be equal; one containing ':' (":id/url_bar") is a suffix.
     */
    val viewIds: List<String> = emptyList(),
    /** Case-insensitive equality with the node's text or content description, trimmed. */
    val labels: List<String> = emptyList(),
    /** Case-insensitive substring of the node's text or content description. */
    val contains: List<String> = emptyList(),
    /** viewId (bare HTML id, exact) of an ancestor the node must sit under. */
    val within: String? = null,
) {
    val isEmpty: Boolean get() = viewIds.isEmpty() && labels.isEmpty() && contains.isEmpty()

    fun matchesNode(n: NodeSnap): Boolean {
        if (isEmpty) return false
        if (viewIds.isNotEmpty()) {
            val id = n.viewId ?: return false
            if (viewIds.none { if (':' in it) id.endsWith(it) else id == it }) return false
        }
        val names = listOfNotNull(n.text?.trim(), n.desc?.trim()).map { it.lowercase() }
        if (labels.isNotEmpty() && labels.none { l -> names.any { it == l.lowercase() } }) return false
        if (contains.isNotEmpty() && contains.none { c -> names.any { it.contains(c.lowercase()) } }) return false
        return true
    }
}

/** What a browser package's "start" section holds. */
data class BrowserStart(
    /** Address bar view ids; empty means "use the nav section's". */
    val urlBarViewIds: List<String>,
    val sites: List<StartPlan>,
)

data class StartPlan(
    val site: String,
    /** Page matching is the nav plan's: [url] on the address bar when present, else [title] on the page title. */
    val url: Regex?,
    val title: Regex?,
    /** The element that starts the player when clicked. */
    val control: NodeMatcher,
    /** Ancestors to try when the matched node refuses a click. */
    val climb: Int = 2,
    /** Present means "not started". Defaults to [control]. */
    val notStarted: NodeMatcher = control,
    /** Present means "started", whatever [notStarted] says. Optional. */
    val started: NodeMatcher? = null,
    /**
     * The loaded player's own play button, clicked once it is there when the
     * command asks for playback (a player that loads paused, like AnimeWorld's
     * native `<video controls>`). Optional.
     */
    val play: NodeMatcher? = null,
    /** How [control] is pressed ("click"/"tap", in order); null = the package's `press`. */
    val press: List<String>? = null,
    /** How long the player gets to appear after the click, and how often to look. */
    val waitMs: Long = 6_000,
    val pollMs: Long = 300,
)

enum class PlayerState { NOT_STARTED, STARTED }

sealed interface StartStep {
    /** Nothing to do here: run the command as it is. */
    data object Proceed : StartStep
    /** The player is not there: click [node] (the plan's control), then wait for it. */
    data class ClickControl(val plan: StartPlan, val node: Int) : StartStep
    /** The player is there and paused (its button says play): click that button [node]. */
    data class ClickPlay(val plan: StartPlan, val node: Int) : StartStep
    /** The page needs starting and the control cannot be found. */
    data class ControlMissing(val plan: StartPlan) : StartStep
}

object PlayerStart {

    /**
     * Commands that need a player to act on. Not nav (it changes the page), not
     * status, not fullscreen.exit, and not an explicit pause: starting a player
     * in order to pause it would be the opposite of what was asked.
     */
    fun wantsPlayer(command: Command): Boolean = when (command) {
        is Command.PlayPause -> command.play != false
        is Command.Seek, is Command.SeekTo, is Command.Fullscreen -> true
        else -> false
    }

    /** Commands whose whole point is to make the video play. */
    fun wantsPlayback(command: Command): Boolean = command is Command.PlayPause && command.play != false

    /** The address bar text, when the bar is in the tree. */
    fun url(urlBarViewIds: List<String>, nodes: List<NodeSnap>): String? =
        nodes.firstOrNull { n -> n.viewId != null && urlBarViewIds.any { n.viewId.endsWith(it) } }
            ?.text?.trim()?.takeIf { it.isNotEmpty() }

    /** The first plan that applies to this window; null without a WebView or a match. */
    fun plan(start: BrowserStart, urlBarViewIds: List<String>, nodes: List<NodeSnap>): StartPlan? {
        val web = nodes.indexOfFirst { it.className == WEBVIEW }
        if (web < 0) return null
        val title = nodes[web].text?.trim().orEmpty()
        val url = url(urlBarViewIds, nodes)
        return start.sites.firstOrNull { pageMatches(it.url, it.title, url, title) }
    }

    fun pageMatches(urlRx: Regex?, titleRx: Regex?, url: String?, title: String): Boolean = when {
        url != null && urlRx != null -> urlRx.containsMatchIn(url)
        titleRx != null -> titleRx.containsMatchIn(title)
        else -> false
    }

    /** True when the address bar shows a page [plan] does not cover: a popup tab in front. */
    fun foreign(urlBarViewIds: List<String>, plan: StartPlan, nodes: List<NodeSnap>): Boolean {
        val url = url(urlBarViewIds, nodes) ?: return false
        return plan.url != null && !plan.url.containsMatchIn(url)
    }

    /** First node inside the WebView matching [m], in tree order. */
    fun find(m: NodeMatcher?, nodes: List<NodeSnap>): Int? {
        if (m == null || m.isEmpty) return null
        val inWeb = BooleanArray(nodes.size)
        val inWithin = BooleanArray(nodes.size)
        for ((i, n) in nodes.withIndex()) {
            val p = n.parent
            inWeb[i] = n.className == WEBVIEW || (p >= 0 && inWeb[p])
            // A node is "within" when an ancestor (not itself) carries the id.
            inWithin[i] = p >= 0 && (inWithin[p] || (inWeb[p] && nodes[p].viewId == m.within))
            if (!inWeb[i] || (m.within != null && !inWithin[i])) continue
            if (m.matchesNode(n)) return i
        }
        return null
    }

    fun state(plan: StartPlan, nodes: List<NodeSnap>): PlayerState = when {
        find(plan.started, nodes) != null -> PlayerState.STARTED
        find(plan.notStarted, nodes) != null -> PlayerState.NOT_STARTED
        else -> PlayerState.STARTED
    }

    /**
     * What to do before [command], judged on the page in front only. A media
     * session is deliberately not consulted: the browser holds one for any tab
     * that ever played (seen on the emulator: a session in Chrome while the
     * page in front still showed its cover), so it says nothing about this page.
     * For the same reason a visible play button of this page's player is
     * pressed directly rather than trusting the session to reach the right video.
     */
    fun decide(
        command: Command,
        start: BrowserStart,
        urlBarViewIds: List<String>,
        nodes: List<NodeSnap>,
    ): StartStep {
        if (!wantsPlayer(command)) return StartStep.Proceed
        val plan = plan(start, urlBarViewIds, nodes) ?: return StartStep.Proceed
        return when (state(plan, nodes)) {
            PlayerState.NOT_STARTED ->
                find(plan.control, nodes)?.let { StartStep.ClickControl(plan, it) }
                    ?: StartStep.ControlMissing(plan)
            PlayerState.STARTED ->
                if (wantsPlayback(command)) find(plan.play, nodes)?.let { StartStep.ClickPlay(plan, it) } ?: StartStep.Proceed
                else StartStep.Proceed
        }
    }

    private const val WEBVIEW = "android.webkit.WebView"
}
