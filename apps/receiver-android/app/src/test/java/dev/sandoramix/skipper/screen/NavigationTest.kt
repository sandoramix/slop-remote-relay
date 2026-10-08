package dev.sandoramix.skipper.screen

import dev.sandoramix.skipper.screen.recipes.BrowserNav
import dev.sandoramix.skipper.screen.recipes.NavAction
import dev.sandoramix.skipper.screen.recipes.NavPage
import dev.sandoramix.skipper.screen.recipes.NavPlan
import dev.sandoramix.skipper.screen.recipes.NavRefusal
import dev.sandoramix.skipper.screen.recipes.Navigation
import dev.sandoramix.skipper.screen.recipes.NodeSnap
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The navigation logic against trees shaped like the ones Chrome exposes for
 * AnimeWorld (from `uiautomator dump` on the emulator, with the receiver's
 * accessibility service on). Strings are verbatim from those dumps.
 */
class NavigationTest {

    /** The plan as written in recipes.json. */
    private val plan = NavPlan(
        site = "animeworld",
        url = Regex("^(https?://)?(www\\.)?animeworld\\.[a-z]+/play/"),
        title = Regex(" - AnimeWorld$"),
        current = Regex("Episodio (\\S+)"),
        currentNode = "episode-comment",
        list = "animeId",
        ranges = Regex("^(\\d+) - (?:.* - )?(\\d+)$"),
        prev = Regex("Precedente$"),
        next = Regex("Successivo$"),
    )
    private val nav = BrowserNav(listOf(":id/url_bar"), listOf(plan))

    private class Tree {
        val nodes = mutableListOf<NodeSnap>()
        fun add(parent: Int, cls: String = "android.view.View", id: String? = null, text: String? = null,
                desc: String? = null, clickable: Boolean = false): Int {
            nodes += NodeSnap(parent, cls, id, text, desc, clickable)
            return nodes.size - 1
        }
    }

    private fun page(
        title: String,
        episodes: List<String>,
        url: String? = null,
        ranges: String? = null,
        buttons: Boolean = true,
        /** Text of the comments tab ("Episodio 900"), which the site keeps current. */
        commentTab: String? = null,
    ): List<NodeSnap> = Tree().run {
        val root = add(-1, "android.widget.FrameLayout")
        val coordinator = add(root, "android.view.ViewGroup", id = "com.android.chrome:id/coordinator")
        val web = add(coordinator, "android.webkit.WebView", text = title)
        val main = add(web, id = "main")
        val controls = add(main, id = "controls")
        if (buttons) {
            add(controls, "android.widget.TextView", text = "? Precedente")
            add(controls, "android.widget.TextView", text = "> Successivo")
        }
        val animeId = add(main, id = "animeId")
        val server = add(animeId)
        add(server, "android.widget.TextView", text = "SERVER")
        add(server, "android.widget.TextView", text = "AnimeWorld Server", clickable = true)
        ranges?.let { add(animeId, "android.widget.TextView", text = it) }
        val list = add(animeId, "android.widget.ListView")
        for (e in episodes) {
            val li = add(list)
            val a = add(li, desc = e, clickable = true)
            add(a, "android.widget.TextView", text = e)
        }
        commentTab?.let { add(main, "android.widget.TextView", id = "episode-comment", text = it, clickable = true) }
        // Clickable, labelled, but outside the list: must never count as an episode.
        add(main, desc = "MyAnimeList", clickable = true)
        add(web, desc = "Ultimi episodi", clickable = true)
        if (url != null) {
            val toolbar = add(root, "android.widget.FrameLayout", id = "com.android.chrome:id/toolbar")
            add(toolbar, "android.widget.EditText", id = "com.android.chrome:id/url_bar", text = url, clickable = true)
        }
        nodes
    }

    private val chainsmokerTitle = "Chainsmoker Cat (ITA) Episodio 11 Streaming & Download ITA - AnimeWorld"
    private val chainsmoker = (1..11).map { it.toString() }

    private fun read(nodes: List<NodeSnap>): NavPage = Navigation.read(nav, nodes)!!

    @Test
    fun `current episode comes from the title, the list from the animeId subtree`() {
        val p = read(page(chainsmokerTitle, chainsmoker))
        assertEquals("11", p.current)
        assertEquals(chainsmoker, p.items.map { it.label })
        assertEquals(10, p.index)
        assertTrue(p.hasPrev)
        assertFalse(p.hasNext)
        val status = p.status(withItems = false)
        assertNull(status.items)
        assertEquals(11, status.count)
        assertEquals(chainsmoker, p.status(withItems = true).items)
    }

    @Test
    fun `the site is recognised by its address bar, or by the title when the bar has scrolled away`() {
        val url = "animeworld.ac/play/chainsmoker-cat-ita.quc1Q/HL20PjNyUr"
        assertNotNull(Navigation.read(nav, page(chainsmokerTitle, chainsmoker, url = url)))
        assertNotNull(Navigation.read(nav, page(chainsmokerTitle, chainsmoker)))
        // The address bar wins when it is there: another site with a lookalike title is not ours.
        assertNull(Navigation.read(nav, page(chainsmokerTitle, chainsmoker, url = "example.com/play/x")))
        assertNull(Navigation.read(nav, page("Some other page", chainsmoker)))
        // The anime's own page, not a /play/ page.
        assertNull(Navigation.read(nav, page(chainsmokerTitle, chainsmoker, url = "animeworld.ac/anime/x")))
    }

    @Test
    fun `step clicks the neighbouring episode, not the site's button, while it is in the tree`() {
        val nodes = page("Chainsmoker Cat (ITA) Episodio 5 Streaming & Download ITA - AnimeWorld", chainsmoker)
        val p = read(nodes)
        val back = Navigation.step(p, -1) as NavAction.Click
        assertEquals("4", back.label)
        assertFalse(back.viaButton)
        assertEquals("4", nodes[back.node].desc)
        val fwd = Navigation.step(p, 1) as NavAction.Click
        assertEquals("6", nodes[fwd.node].desc)
    }

    @Test
    fun `a popup tab over the page is told apart from the page loading the next episode`() {
        val url = "animeworld.ac/play/chainsmoker-cat-ita.quc1Q/CdDeKhqpjn"
        assertFalse(Navigation.foreign(nav, plan, page(chainsmokerTitle, chainsmoker, url = url)))
        // Seen on the emulator after a click: AliExpress and google.com tabs.
        assertTrue(Navigation.foreign(nav, plan, page("AliExpress", emptyList(), url = "it.aliexpress.com/?aff_fcid=x")))
        assertTrue(Navigation.foreign(nav, plan, page("Google", emptyList(), url = "google.com")))
        // No address bar in the tree: nothing can be told.
        assertFalse(Navigation.foreign(nav, plan, page("Google", emptyList())))
    }

    @Test
    fun `step refuses at either end and when the current episode is unknown`() {
        val last = read(page(chainsmokerTitle, chainsmoker))
        assertEquals(NavAction.Refuse(NavRefusal.AT_LAST), Navigation.step(last, 1))
        val first = read(page("Chainsmoker Cat (ITA) Episodio 1 Streaming & Download ITA - AnimeWorld", chainsmoker))
        assertEquals(NavAction.Refuse(NavRefusal.AT_FIRST), Navigation.step(first, -1))
        val unknown = read(page("Chainsmoker Cat (ITA) Streaming & Download ITA - AnimeWorld", chainsmoker))
        assertNull(unknown.current)
        assertFalse(unknown.hasPrev || unknown.hasNext)
        assertEquals(NavAction.Refuse(NavRefusal.UNKNOWN_CURRENT), Navigation.step(unknown, 1))
    }

    /** One Piece: 938 entries in ranges of 50, and only the active range is in the tree. */
    private val onePieceRanges =
        "1 - 5051 - 100101 - 150151 - 200201 - 250251 - 300301 - 350351 - 400401 - 450451 - 500501 - 550551 - 600601 - 650651 - 700701 - 750751 - 800801 - 850851 - 900901 - 938"
    // 907 is genuinely missing on the site.
    private val lastRange = ((901..938) - 907).map { it.toString() }

    @Test
    fun `range tabs give the ends of the whole series`() {
        val p = read(page("One Piece (ITA) Episodio 937 Streaming & Download ITA - AnimeWorld", lastRange, ranges = onePieceRanges))
        assertEquals("1", p.first)
        assertEquals("938", p.last)
        assertEquals("937", p.current)
        assertTrue(p.hasNext)
        val atEnd = read(page("One Piece (ITA) Episodio 938 Streaming & Download ITA - AnimeWorld", lastRange, ranges = onePieceRanges))
        assertFalse(atEnd.hasNext)
        assertEquals(NavAction.Refuse(NavRefusal.AT_LAST), Navigation.step(atEnd, 1))
    }

    @Test
    fun `crossing into a hidden range needs the site's button`() {
        val title = "One Piece (ITA) Episodio 901 Streaming & Download ITA - AnimeWorld"
        val p = read(page(title, lastRange, ranges = onePieceRanges))
        assertTrue(p.hasPrev)
        val back = Navigation.step(p, -1) as NavAction.Click
        assertTrue(back.viaButton)
        assertNull(back.label)
        val noButtons = read(page(title, lastRange, ranges = onePieceRanges, buttons = false))
        assertEquals(NavAction.Refuse(NavRefusal.OTHER_RANGE), Navigation.step(noButtons, -1))
    }

    /**
     * Seen on the emulator: from 901, the site's "Precedente" loaded 900 in-page.
     * The address and the comments tab said 900, the title still said 901.
     */
    @Test
    fun `the comments tab names the episode when the title is stale`() {
        val range = (851..900).map { it.toString() }
        val p = read(page("One Piece (ITA) Episodio 901 Streaming & Download ITA - AnimeWorld", range,
            ranges = onePieceRanges, commentTab = "Episodio 900"))
        assertEquals("900", p.current)
        assertEquals(49, p.index)
        assertTrue(p.hasNext)
        // A comments tab that names no episode: the title it is.
        val noTab = read(page(chainsmokerTitle, chainsmoker, commentTab = "Commenti"))
        assertEquals("11", noTab.current)
    }

    @Test
    fun `goto checks the label it was given`() {
        val nodes = page(chainsmokerTitle, chainsmoker)
        val p = read(nodes)
        val ok = Navigation.goto(p, 2, "3") as NavAction.Click
        assertEquals("3", nodes[ok.node].desc)
        assertEquals(NavAction.Refuse(NavRefusal.LIST_CHANGED), Navigation.goto(p, 2, "4"))
        assertEquals(NavAction.Refuse(NavRefusal.LIST_CHANGED), Navigation.goto(p, 99, "100"))
    }

    @Test
    fun `no web content, no navigation`() {
        val nodes = Tree().run {
            val root = add(-1, "android.widget.FrameLayout")
            add(root, "android.widget.EditText", id = "com.android.chrome:id/url_bar", text = "animeworld.ac/play/x")
            nodes
        }
        assertNull(Navigation.read(nav, nodes))
    }
}
