package dev.sandoramix.skipper.screen

import dev.sandoramix.skipper.screen.core.IssueReport
import java.net.URI
import java.net.URLDecoder
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class IssueReportTest {
    private val details = listOf("Android 14 (API 34), Test Phone", "Accessibility: on")

    private fun param(url: String, name: String): String =
        URI(url).rawQuery.split('&').first { it.startsWith("$name=") }
            .substringAfter('=').let { URLDecoder.decode(it.replace("+", "%2B"), "UTF-8") }

    @Test
    fun linkPointsAtTheProjectAndNamesTheAppInTheTitle() {
        val url = IssueReport.url("receiver", "0.8.0", details, "a line")
        assertTrue(url.startsWith("${IssueReport.ISSUES_NEW}?"))
        assertEquals("[receiver 0.8.0] ", param(url, "title"))
    }

    @Test
    fun bodyCarriesDetailsAndNewestLinesInEnglish() {
        val body = param(IssueReport.url("receiver", "0.8.0", details, "first\nsecond"), "body")
        assertTrue(body.contains("**What happened?**"))
        assertTrue(body.contains("- Android 14 (API 34), Test Phone"))
        assertTrue(body.contains("first\nsecond"))
    }

    @Test
    fun longLogIsCutToItsNewestLinesAndTheLinkFits() {
        val log = (0 until 500).joinToString("\n") { "10-24 12:00:00.%03d I/x: line $it ${"y".repeat(80)}".format(it) }
        val url = IssueReport.url("receiver", "0.8.0", details, log)
        val body = param(url, "body")
        assertTrue(IssueReport.encode(body).length <= IssueReport.MAX_ENCODED_BODY)
        assertTrue(url.length < 8000)
        assertTrue(body.contains("line 499 "))
        assertFalse(body.contains("line 0 "))
        assertTrue(body.contains("of 500 lines"))
    }

    @Test
    fun logThatCannotFitPointsAtTheClipboard() {
        val body = param(IssueReport.url("receiver", "0.8.0", listOf("d".repeat(IssueReport.MAX_ENCODED_BODY)), "x"), "body")
        assertTrue(body.contains("clipboard"))
        assertFalse(body.contains("```"))
    }
}
