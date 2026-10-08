package dev.sandoramix.skipper.screen

import dev.sandoramix.skipper.screen.update.LATEST_RELEASE_API
import dev.sandoramix.skipper.screen.update.compareVersions
import dev.sandoramix.skipper.screen.update.parseChecksum
import dev.sandoramix.skipper.screen.update.parseRelease
import dev.sandoramix.skipper.screen.update.releaseSummary
import dev.sandoramix.skipper.screen.update.resolveApiUrl
import dev.sandoramix.skipper.screen.update.selectApk
import dev.sandoramix.skipper.screen.update.selectChecksums
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Parity with packages/protocol/src/version.test.ts: same cases, same answers. */
class UpdateCheckerTest {

    @Test fun ordersNumericallyNotLexically() {
        assertTrue(compareVersions("0.10.0", "0.9.9") > 0)
        assertTrue(compareVersions("v1.2.3", "1.2.4") < 0)
        assertEquals(0, compareVersions("v0.2.1", "0.2.1"))
        assertEquals(0, compareVersions("1.2", "1.2.0"))
    }

    @Test fun preReleaseIsBelowTheRelease() {
        assertTrue(compareVersions("0.3.0-beta.1", "0.3.0") < 0)
        assertTrue(compareVersions("0.3.0", "0.3.0-beta.1") > 0)
        assertTrue(compareVersions("0.3.0-beta.1", "0.2.9") > 0)
    }

    private val sample = """
        {
          "url": "https://api.github.com/repos/sandoramix/slop-remote-relay/releases/1",
          "html_url": "https://github.com/sandoramix/slop-remote-relay/releases/tag/v0.3.0",
          "tag_name": "v0.3.0",
          "name": "v0.3.0",
          "draft": false,
          "prerelease": false,
          "published_at": "2026-09-30T10:00:00Z",
          "assets": [
            {"name": "relay-controller-0.3.0.apk", "size": 100, "browser_download_url": "https://github.com/x/releases/download/v0.3.0/relay-controller-0.3.0.apk"},
            {"name": "relay-receiver-0.3.0.apk", "size": 4096, "browser_download_url": "https://github.com/x/releases/download/v0.3.0/relay-receiver-0.3.0.apk"},
            {"name": "SHA256SUMS.txt", "size": 300, "browser_download_url": "https://github.com/x/releases/download/v0.3.0/SHA256SUMS.txt"}
          ],
          "body": "## Highlights\n\n- **iPhone** remote\n- image `x/y` renamed\n\n## What's changed\n\n- **x:** y (abc1234)\n\n## Downloads\n\n- not this"
        }
    """.trimIndent()

    @Test fun parsesAGithubRelease() {
        val r = parseRelease(sample)
        assertEquals("0.3.0", r.version)
        assertEquals("v0.3.0", r.tag)
        assertEquals("https://github.com/sandoramix/slop-remote-relay/releases/tag/v0.3.0", r.pageUrl)
        assertEquals("2026-09-30T10:00:00Z", r.publishedAt)
        assertEquals(3, r.assets.size)
        assertEquals(4096L, r.assets[1].size)
        assertFalse(r.important)
    }

    @Test fun flagsBreakingAndSecurityAsImportant() {
        fun important(body: String) = parseRelease(
            """{"tag_name":"v0.3.0","html_url":"u","published_at":"d","body":${org.json.JSONObject.quote(body)}}""",
        ).important
        assertTrue(important("- **BREAKING** new protocol"))
        assertTrue(important("Fixes a security issue"))
        assertTrue(important("correzione di sicurezza"))
        assertFalse(important("- faster seek"))
        assertEquals("0.3.0", parseRelease("""{"tag_name":"v0.3.0","html_url":"u","published_at":"d","body":null}""").version)
        assertEquals("", parseRelease("""{"tag_name":"v0.3.0","html_url":"u","published_at":"d","body":null}""").notes)
    }

    @Test fun selectsTheReceiverApkAndTheChecksums() {
        val r = parseRelease(sample)
        assertEquals("relay-receiver-0.3.0.apk", selectApk(r)?.name)
        assertEquals("SHA256SUMS.txt", selectChecksums(r)?.name)
        val bare = parseRelease("""{"tag_name":"v1","html_url":"u","published_at":"d","assets":[{"name":"relay-controller-1.apk","size":1,"browser_download_url":"x"}]}""")
        assertNull(selectApk(bare))
        assertNull(selectChecksums(bare))
    }

    @Test fun findsAChecksumInASha256sumListing() {
        val sums = "AABB11  relay-controller-0.3.0.apk\nccdd22 *relay-receiver-0.3.0.apk\n"
        assertEquals("ccdd22", parseChecksum(sums, "relay-receiver-0.3.0.apk"))
        assertEquals("aabb11", parseChecksum(sums, "relay-controller-0.3.0.apk"))
        assertNull(parseChecksum(sums, "other.apk"))
    }

    @Test fun summaryUsesOnlyHighlightsWithoutMarkdown() {
        val notes = "## Highlights\n\n- **iPhone** remote\n- image `x/y` renamed\n\n## What's changed\n\n- **x:** y (abc1234)\n\n## Downloads\n\n- not this"
        assertEquals(listOf("iPhone remote", "image x/y renamed"), releaseSummary(notes))
    }

    @Test fun summaryFallsBackToTheChangelogWithoutHashes() {
        val notes = "## What's changed\n\n### Fixes\n\n- **x:** y (abc1234)\n\n## Downloads\n\n- not this"
        assertEquals(listOf("x: y"), releaseSummary(notes))
    }

    @Test fun summaryJoinsABulletThatWrapsOntoIndentedLines() {
        val notes = "## Highlights\n\n- **Store zip.** Releases now\n  include it.\n- Two\n\n  not a continuation"
        assertEquals(listOf("Store zip. Releases now include it.", "Two"), releaseSummary(notes))
    }

    @Test fun summaryHonoursMaxLines() {
        val notes = "## Highlights\n\n- a\n- b\n- c\n"
        assertEquals(listOf("a", "b"), releaseSummary(notes, 2))
    }

    @Test fun apiUrlOverrideOnlyInDebugBuilds() {
        assertEquals("http://10.0.2.2:8099/latest", resolveApiUrl(true, "http://10.0.2.2:8099/latest"))
        assertEquals(LATEST_RELEASE_API, resolveApiUrl(false, "http://10.0.2.2:8099/latest"))
        assertEquals(LATEST_RELEASE_API, resolveApiUrl(true, null))
        assertEquals("https://api.github.com/repos/sandoramix/slop-remote-relay/releases/latest", LATEST_RELEASE_API)
    }
}
