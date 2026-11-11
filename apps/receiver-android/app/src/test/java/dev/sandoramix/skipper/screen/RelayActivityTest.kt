package dev.sandoramix.skipper.screen

import dev.sandoramix.skipper.screen.core.Command
import dev.sandoramix.skipper.screen.core.RelayActivity
import dev.sandoramix.skipper.screen.core.RelayActivity.Entry
import dev.sandoramix.skipper.screen.core.clock
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test

class RelayActivityTest {

    @Before
    fun fresh() = RelayActivity.reset()

    private fun entry(at: Long, ok: Boolean = true) =
        Entry(at, Command.Fullscreen(toggle = false), ok, via = "lan", executor = "accessibility", detail = null)

    @Test
    fun nobodyIsConnectedUntilAFrameArrives() {
        assertNull(RelayActivity.connectedVia(nowMs = 1_000))
    }

    @Test
    fun aFrameMakesTheControllerConnectedOnThatPath() {
        RelayActivity.controllerSeen("mqtt", nowMs = 5_000)
        assertEquals("mqtt", RelayActivity.connectedVia(nowMs = 6_000))
    }

    @Test
    fun aQuietControllerIsNoLongerConnected() {
        RelayActivity.controllerSeen("lan", nowMs = 5_000)
        assertEquals("lan", RelayActivity.connectedVia(nowMs = 5_000 + RelayActivity.CONNECTED_WINDOW_MS))
        assertNull(RelayActivity.connectedVia(nowMs = 5_001 + RelayActivity.CONNECTED_WINDOW_MS))
    }

    @Test
    fun theLatestPathWins() {
        RelayActivity.controllerSeen("mqtt", nowMs = 1_000)
        RelayActivity.controllerSeen("lan", nowMs = 2_000)
        assertEquals("lan", RelayActivity.connectedVia(nowMs = 3_000))
    }

    @Test
    fun recentIsNewestFirstAndCapped() {
        for (i in 1..(RelayActivity.MAX_ENTRIES + 3)) RelayActivity.record(entry(at = i.toLong()))
        val recent = RelayActivity.recent()
        assertEquals(RelayActivity.MAX_ENTRIES, recent.size)
        assertEquals((RelayActivity.MAX_ENTRIES + 3).toLong(), recent.first().atMs)
        assertEquals(4L, recent.last().atMs)
    }

    @Test
    fun resetForgetsEverything() {
        RelayActivity.controllerSeen("lan", nowMs = 1_000)
        RelayActivity.record(entry(at = 1))
        RelayActivity.livePaths = listOf("lan")
        RelayActivity.reset()
        assertNull(RelayActivity.connectedVia(nowMs = 1_000))
        assertEquals(0, RelayActivity.recent().size)
        assertEquals(0, RelayActivity.livePaths.size)
    }

    @Test
    fun clockShowsPositionsLikeAPlayer() {
        assertEquals("0:05", clock(5_000))
        assertEquals("1:30", clock(90_000))
        assertEquals("1:02:03", clock(3_723_000))
        assertEquals("0:00", clock(-5))
    }
}
