package dev.sandoramix.skipper.screen.core

import java.net.URLEncoder

/**
 * A prefilled "new issue" link for the project's GitHub repository. Twin of
 * `packages/protocol/src/issue.ts`.
 *
 * No token and no server: the app opens the link and the person submits the
 * issue from their own account. The text is always English, whatever language
 * the app is in, because the developer reads it. A URL holds only about 8 KB,
 * so only the newest log lines go in; the full report is also put on the
 * clipboard for pasting.
 */
object IssueReport {
    const val ISSUES_NEW = "https://github.com/sandoramix/slop-remote-relay/issues/new"

    /** GitHub refuses a request line past 8192 bytes; this leaves room for the host and the title. */
    const val MAX_ENCODED_BODY = 6000

    private const val MAX_LOG_LINES = 60

    fun url(app: String, version: String, details: List<String>, log: String): String {
        val all = log.split('\n').filter { it.isNotEmpty() }
        var n = minOf(all.size, MAX_LOG_LINES)
        var text = body(details, all.takeLast(n), all.size)
        // Drop the oldest lines until the encoded body fits.
        while (n > 0 && encode(text).length > MAX_ENCODED_BODY) {
            n = maxOf(0, n - 5)
            text = body(details, all.takeLast(n), all.size)
        }
        return "$ISSUES_NEW?title=${encode("[$app $version] ")}&body=${encode(text)}"
    }

    fun body(details: List<String>, lines: List<String>, total: Int): String {
        val shown = if (lines.isEmpty()) {
            "_The log is too long for this link and is on your clipboard: paste it here._"
        } else {
            "Last ${lines.size} of $total lines. The full log is on your clipboard: paste it below if it helps.\n\n" +
                "```\n${lines.joinToString("\n")}\n```"
        }
        return listOf(
            "**What happened?**",
            "",
            "<!-- Describe what you did and what you expected. -->",
            "",
            "",
            "**Details**",
            *details.map { "- $it" }.toTypedArray(),
            "",
            "**Log**",
            shown,
        ).joinToString("\n")
    }

    /** Same output as JavaScript's encodeURIComponent for what we send: URLEncoder writes a space as '+'. */
    fun encode(s: String): String = URLEncoder.encode(s, "UTF-8").replace("+", "%20")
}
