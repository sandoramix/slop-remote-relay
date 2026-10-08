package dev.sandoramix.skipper.screen.recipes

import dev.sandoramix.skipper.screen.core.NavStatus

/**
 * Episode navigation in a browser, as data plus a little pure logic.
 *
 * A plan (recipes.json, "nav" under a browser package) says how to recognise a
 * site and where its page keeps the list of episodes in the accessibility tree.
 * Nothing here knows about any particular site, and nothing here touches
 * AccessibilityNodeInfo: the executor flattens the window into [NodeSnap]s, this
 * file decides, and the executor clicks the node it is told to. That split is
 * what makes the logic testable on the JVM.
 */

/** One node of the active window, flattened in depth-first order. */
data class NodeSnap(
    /** Index of the parent in the same list; -1 for the root. Always lower than this node's own index. */
    val parent: Int,
    val className: String? = null,
    /** viewIdResourceName. Chromium reports a web element's HTML id here, bare ("animeId"). */
    val viewId: String? = null,
    val text: String? = null,
    val desc: String? = null,
    val clickable: Boolean = false,
)

/** What a browser package's "nav" section holds. */
data class BrowserNav(
    /** View ids (suffix match) of the browser's address bar, e.g. ":id/url_bar". */
    val urlBarViewIds: List<String>,
    val sites: List<NavPlan>,
)

data class NavPlan(
    val site: String,
    /** Matched against the address bar text when the bar is in the tree. */
    val url: Regex?,
    /**
     * Matched against the page title when it is not. Chrome drops its toolbar
     * from the tree once the page scrolls, which is exactly while a video is
     * being watched, so the title is the usual way in.
     */
    val title: Regex?,
    /**
     * Group 1 is the current entry's label, read from the text of the
     * [currentNode] element when there is one in the page, else from the title.
     */
    val current: Regex,
    /**
     * viewId (HTML id) of an element whose text names the current entry. Needed
     * where the site switches episodes in-page: AnimeWorld's own buttons load the
     * next episode by script and rewrite the address, but not the title.
     */
    val currentNode: String? = null,
    /** viewId (the HTML id) of the element that contains the list of episodes. */
    val list: String,
    /** Optional filter on an entry's label. */
    val itemLabel: Regex? = null,
    /**
     * Matched against text inside [list]: group 1 is the first entry of the whole
     * series and group 2 the last. Long series show one range at a time, and only
     * that range is in the tree; this is how the ends of the series are known.
     */
    val ranges: Regex? = null,
    /** The page's own previous/next controls, matched against node text. */
    val prev: Regex? = null,
    val next: Regex? = null,
)

data class NavItem(val label: String, val node: Int)

/** What the page says right now, under one plan. */
data class NavPage(
    val plan: NavPlan,
    val items: List<NavItem>,
    val current: String?,
    /** Position of [current] in [items]; null when it cannot be told. */
    val index: Int?,
    /** Ends of the whole series, when the page shows them (range tabs). */
    val first: String?,
    val last: String?,
    val prevButton: Int?,
    val nextButton: Int?,
) {
    val hasPrev: Boolean
        get() = index != null && (index > 0 || (first != null && current != first))

    val hasNext: Boolean
        get() = index != null && (index < items.size - 1 || (last != null && current != last))

    fun status(withItems: Boolean) = NavStatus(
        current = current,
        hasPrev = hasPrev,
        hasNext = hasNext,
        items = if (withItems) items.map { it.label } else null,
        index = index,
        count = items.size,
    )
}

enum class NavRefusal { UNKNOWN_CURRENT, AT_FIRST, AT_LAST, OTHER_RANGE, LIST_CHANGED }

sealed interface NavAction {
    /**
     * Click [node]. [label] is where the step should land, when that is known
     * (it is not when crossing into a hidden range). [viaButton] says the node is
     * the site's own previous/next control rather than an episode link.
     */
    data class Click(val node: Int, val label: String?, val viaButton: Boolean = false) : NavAction
    data class Refuse(val reason: NavRefusal) : NavAction
}

object Navigation {

    /** The first plan of [nav] that applies to this window, read into a page. */
    fun read(nav: BrowserNav, nodes: List<NodeSnap>): NavPage? {
        val web = nodes.indexOfFirst { it.className == WEBVIEW }
        if (web < 0) return null
        val title = nodes[web].text?.trim().orEmpty()
        val url = url(nav, nodes)

        val plan = nav.sites.firstOrNull { applies(it, url, title) } ?: return null
        return readPage(plan, nodes, web, title)
    }

    /** The address bar text, when the bar is in the tree. */
    fun url(nav: BrowserNav, nodes: List<NodeSnap>): String? =
        nodes.firstOrNull { n -> n.viewId != null && nav.urlBarViewIds.any { n.viewId.endsWith(it) } }
            ?.text?.trim()?.takeIf { it.isNotEmpty() }

    /**
     * True when the browser shows an address [plan] does not cover: a tab the
     * site's ad script opened over it on our click (AnimeWorld does this on
     * every click, links and buttons alike). Without the address bar in the tree
     * nothing can be told, and the answer is false.
     */
    fun foreign(nav: BrowserNav, plan: NavPlan, nodes: List<NodeSnap>): Boolean {
        val url = url(nav, nodes) ?: return false
        return plan.url != null && !plan.url.containsMatchIn(url)
    }

    fun applies(plan: NavPlan, url: String?, title: String): Boolean = when {
        url != null && plan.url != null -> plan.url.containsMatchIn(url)
        plan.title != null -> plan.title.containsMatchIn(title)
        else -> false
    }

    private fun readPage(plan: NavPlan, nodes: List<NodeSnap>, web: Int, title: String): NavPage {
        val inWeb = BooleanArray(nodes.size)
        val inList = BooleanArray(nodes.size)
        for ((i, n) in nodes.withIndex()) {
            val p = n.parent
            inWeb[i] = i == web || (p >= 0 && inWeb[p])
            inList[i] = inWeb[i] && (n.viewId == plan.list || (p >= 0 && inList[p]))
        }

        val items = nodes.indices.mapNotNull { i ->
            val n = nodes[i]
            val label = n.desc?.trim()
            if (!inList[i] || !n.clickable || label.isNullOrEmpty()) return@mapNotNull null
            if (plan.itemLabel != null && !plan.itemLabel.containsMatchIn(label)) return@mapNotNull null
            NavItem(label, i)
        }

        val range = plan.ranges?.let { rx ->
            nodes.indices.firstNotNullOfOrNull { i ->
                if (inList[i]) nodes[i].text?.trim()?.let { rx.find(it) } else null
            }
        }

        val currentText = plan.currentNode
            ?.let { id -> nodes.indices.firstOrNull { inWeb[it] && nodes[it].viewId == id } }
            ?.let { nodes[it].text?.trim() }
            ?.takeIf { plan.current.containsMatchIn(it) }
            ?: title
        val current = plan.current.find(currentText)?.groupValues?.getOrNull(1)?.trim()?.takeIf { it.isNotEmpty() }
        val index = current?.let { c -> items.indexOfFirst { it.label == c }.takeIf { it >= 0 } }

        fun button(rx: Regex?): Int? = rx?.let {
            nodes.indices.firstOrNull { i -> inWeb[i] && nodes[i].text?.trim()?.let(rx::containsMatchIn) == true }
        }

        return NavPage(
            plan = plan,
            items = items,
            current = current,
            index = index,
            first = range?.groupValues?.getOrNull(1),
            last = range?.groupValues?.getOrNull(2),
            prevButton = button(plan.prev),
            nextButton = button(plan.next),
        )
    }

    /**
     * The neighbouring episode's link first, the site's own button only to
     * cross into a range that is not in the tree. Measured on the emulator: a
     * click on an AnimeWorld link navigates even when the site's ad script
     * opens a popup on it, while a click on its "Precedente" button was
     * swallowed by that popup and the page stayed where it was.
     */
    fun step(page: NavPage, delta: Int): NavAction {
        val index = page.index ?: return NavAction.Refuse(NavRefusal.UNKNOWN_CURRENT)
        if (delta > 0 && !page.hasNext) return NavAction.Refuse(NavRefusal.AT_LAST)
        if (delta < 0 && !page.hasPrev) return NavAction.Refuse(NavRefusal.AT_FIRST)

        page.items.getOrNull(index + delta)?.let { return NavAction.Click(it.node, it.label) }
        val button = (if (delta > 0) page.nextButton else page.prevButton)
            ?: return NavAction.Refuse(NavRefusal.OTHER_RANGE)
        return NavAction.Click(button, null, viaButton = true)
    }

    /** `index` and `label` as the controller last saw them; a list that changed since is refused. */
    fun goto(page: NavPage, index: Int, label: String): NavAction {
        val item = page.items.getOrNull(index)
        if (item == null || item.label != label) return NavAction.Refuse(NavRefusal.LIST_CHANGED)
        return NavAction.Click(item.node, item.label)
    }

    private const val WEBVIEW = "android.webkit.WebView"
}
