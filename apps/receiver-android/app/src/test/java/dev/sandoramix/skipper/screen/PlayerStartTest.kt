package dev.sandoramix.skipper.screen

import dev.sandoramix.skipper.screen.core.Command
import dev.sandoramix.skipper.screen.recipes.BrowserStart
import dev.sandoramix.skipper.screen.recipes.NodeMatcher
import dev.sandoramix.skipper.screen.recipes.NodeSnap
import dev.sandoramix.skipper.screen.recipes.PlayerStart
import dev.sandoramix.skipper.screen.recipes.PlayerState
import dev.sandoramix.skipper.screen.recipes.StartPlan
import dev.sandoramix.skipper.screen.recipes.StartStep
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The start logic against trees shaped like the ones Chrome exposes for an
 * AnimeWorld episode page before and after its player cover is clicked (from
 * `uiautomator dump` on the emulator, receiver accessibility service on).
 */
class PlayerStartTest {

    /** The plan as written in recipes.json. */
    private val plan = StartPlan(
        site = "animeworld",
        url = Regex("^(https?://)?(www\\.)?animeworld\\.[a-z]+/play/"),
        title = Regex(" - AnimeWorld$"),
        control = NodeMatcher(viewIds = listOf("player-cover")),
        started = NodeMatcher(viewIds = listOf("player-iframe")),
        play = NodeMatcher(labels = listOf("play"), within = "player-iframe"),
    )
    private val start = BrowserStart(emptyList(), listOf(plan))
    private val bar = listOf(":id/url_bar")

    private class Tree {
        val nodes = mutableListOf<NodeSnap>()
        fun add(parent: Int, cls: String = "android.view.View", id: String? = null, text: String? = null,
                desc: String? = null, clickable: Boolean = false): Int {
            nodes += NodeSnap(parent, cls, id, text, desc, clickable)
            return nodes.size - 1
        }
    }

    private val title = "Chainsmoker Cat (ITA) Episodio 11 Streaming & Download ITA - AnimeWorld"

    private fun page(
        cover: Boolean,
        iframe: Boolean = !cover,
        playLabel: String? = "play",
        url: String? = null,
        pageTitle: String = title,
    ): List<NodeSnap> = Tree().run {
        val root = add(-1, "android.widget.FrameLayout")
        if (url != null) add(root, "android.widget.EditText", id = "com.android.chrome:id/url_bar", text = url)
        val web = add(root, "android.webkit.WebView", text = pageTitle)
        // A player-looking label outside the player: must never be taken for it.
        val yt = add(web, "android.view.View")
        add(yt, "android.widget.Button", text = "Play video", clickable = true)
        add(yt, "android.widget.Button", text = "play", clickable = true)
        val player = add(web, id = "player")
        if (cover) add(player, "android.widget.TextView", id = "player-cover")
        if (iframe) {
            // As dumped: the iframe's document is not a WebView node of its own,
            // and it has a "player" div of its own around the <video>.
            val frame = add(player, id = "player-iframe")
            val inner = add(frame, id = "player")
            val video = add(inner, id = "video-player")
            if (playLabel != null) add(video, "android.widget.Button", text = playLabel, clickable = true)
            add(video, "android.widget.Button", text = "mute", clickable = true)
            add(video, "android.widget.Button", text = "enter full screen", clickable = true)
            add(video, "android.widget.SeekBar", text = "elapsed time: 0:00, video time scrubber", clickable = true)
        }
        add(web, "android.widget.TextView", text = "? Precedente")
        nodes
    }

    private fun decide(command: Command, nodes: List<NodeSnap>) =
        PlayerStart.decide(command, start, bar, nodes)

    @Test
    fun `cover present means not started, and the cover is the control`() {
        val nodes = page(cover = true)
        assertEquals(PlayerState.NOT_STARTED, PlayerStart.state(plan, nodes))
        val step = decide(Command.PlayPause(null), nodes)
        assertTrue(step is StartStep.ClickControl)
        assertEquals("player-cover", nodes[(step as StartStep.ClickControl).node].viewId)
    }

    @Test
    fun `iframe present means started`() {
        assertEquals(PlayerState.STARTED, PlayerStart.state(plan, page(cover = false)))
        // Both at once (the cover not yet removed): the started marker wins.
        assertEquals(PlayerState.STARTED, PlayerStart.state(plan, page(cover = true, iframe = true)))
    }

    @Test
    fun `commands that need a player start it, the others never do`() {
        val nodes = page(cover = true)
        for (c in listOf(Command.PlayPause(null), Command.PlayPause(true), Command.Seek(30_000),
                         Command.SeekTo(0), Command.Fullscreen(true))) {
            assertTrue("$c", decide(c, nodes) is StartStep.ClickControl)
        }
        for (c in listOf(Command.PlayPause(false), Command.FullscreenExit, Command.NavStep(1),
                         Command.NavGoto(0, "1"), Command.Status())) {
            assertEquals("$c", StartStep.Proceed, decide(c, nodes))
        }
    }

    @Test
    fun `missing control is reported`() {
        val noCover = StartPlan(
            site = "animeworld", url = null, title = plan.title,
            control = NodeMatcher(viewIds = listOf("player-cover")),
            notStarted = NodeMatcher(viewIds = listOf("player")),
        )
        val step = PlayerStart.decide(Command.PlayPause(null), BrowserStart(emptyList(), listOf(noCover)), bar,
            page(cover = false, iframe = false))
        assertTrue(step is StartStep.ControlMissing)
    }

    @Test
    fun `a loaded paused player gets its play button pressed, only for play`() {
        val nodes = page(cover = false)
        val step = decide(Command.PlayPause(null), nodes)
        assertTrue(step is StartStep.ClickPlay)
        val node = (step as StartStep.ClickPlay).node
        // The one inside the player, not the lookalike outside it.
        assertEquals("play", nodes[node].text)
        assertEquals("video-player", nodes[nodes[node].parent].viewId)
        assertEquals(StartStep.Proceed, decide(Command.Seek(10_000), nodes))
        assertEquals(StartStep.Proceed, decide(Command.Fullscreen(true), nodes))
        // Playing already: the button says pause, nothing to do.
        assertEquals(StartStep.Proceed, decide(Command.PlayPause(null), page(cover = false, playLabel = "pause")))
    }

    @Test
    fun `page matching follows the nav rules`() {
        // Address bar wins when present.
        val other = page(cover = true, url = "example.com/play/x")
        assertEquals(StartStep.Proceed, decide(Command.PlayPause(null), other))
        assertTrue(decide(Command.PlayPause(null), page(cover = true, url = "animeworld.ac/play/x.y/z")) is StartStep.ClickControl)
        // No bar: the title.
        assertEquals(StartStep.Proceed, decide(Command.PlayPause(null), page(cover = true, pageTitle = "Something else")))
        assertTrue(PlayerStart.foreign(bar, plan, other))
        assertFalse(PlayerStart.foreign(bar, plan, page(cover = true)))
    }

    @Test
    fun `matchers`() {
        val n = NodeSnap(0, viewId = "com.android.chrome:id/url_bar", text = "  Enter Full Screen ")
        assertTrue(NodeMatcher(viewIds = listOf(":id/url_bar")).matchesNode(n))
        assertFalse(NodeMatcher(viewIds = listOf("url_bar")).matchesNode(n)) // bare ids are exact
        assertTrue(NodeMatcher(labels = listOf("enter full screen")).matchesNode(n))
        assertFalse(NodeMatcher(labels = listOf("full screen")).matchesNode(n))
        assertTrue(NodeMatcher(contains = listOf("full screen")).matchesNode(n))
        assertFalse(NodeMatcher().matchesNode(n))
        assertNull(PlayerStart.find(NodeMatcher(), page(cover = true)))
    }
}
