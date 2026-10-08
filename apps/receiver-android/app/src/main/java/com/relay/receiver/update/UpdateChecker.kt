package com.relay.receiver.update

import org.json.JSONObject

/**
 * Release versions and the GitHub release they come from. Pure logic, no
 * Android types: it mirrors packages/protocol/src/version.ts and is pinned by
 * UpdateCheckerTest with the same cases as version.test.ts. Keep both in step.
 */

/** Where releases are published. */
const val RELEASES_REPO = "sandoramix/slop-remote-relay"
const val LATEST_RELEASE_API = "https://api.github.com/repos/$RELEASES_REPO/releases/latest"

/**
 * Compares two versions like "0.2.1" or "v1.10.0". Negative when a < b, zero
 * when equal, positive when a > b. A pre-release tag (anything after a dash)
 * makes a version lower than the same version without one.
 */
fun compareVersions(a: String, b: String): Int {
    val x = parseVersion(a)
    val y = parseVersion(b)
    for (i in 0 until maxOf(x.first.size, y.first.size, 3)) {
        val d = (x.first.getOrElse(i) { 0 }) - (y.first.getOrElse(i) { 0 })
        if (d != 0) return d
    }
    val xp = x.second
    val yp = y.second
    if (xp == yp) return 0
    if (xp == null) return 1
    if (yp == null) return -1
    return if (xp < yp) -1 else 1
}

private val LEADING_INT = Regex("^\\s*[+-]?\\d+")
private val LEADING_V = Regex("^v", RegexOption.IGNORE_CASE)

/** Like the TypeScript parse(): split("-", 2) keeps two pieces and drops the rest. */
private fun parseVersion(v: String): Pair<List<Int>, String?> {
    val pieces = v.trim().replace(LEADING_V, "").split("-")
    val core = pieces[0]
    val pre = pieces.getOrNull(1)
    // parseInt(n, 10) || 0: leading digits count, anything else is zero.
    val parts = core.split(".").map { LEADING_INT.find(it)?.value?.trim()?.toIntOrNull() ?: 0 }
    return parts to pre
}

data class ReleaseAsset(val name: String, val url: String, val size: Long)

data class LatestRelease(
    val version: String,
    val tag: String,
    val pageUrl: String,
    /** Release notes, markdown. */
    val notes: String,
    val publishedAt: String,
    val assets: List<ReleaseAsset>,
    /** The notes flag a breaking change or a security fix. The update is still never forced. */
    val important: Boolean,
)

private val IMPORTANT = Regex("\\bBREAKING\\b|security|sicurezza", RegexOption.IGNORE_CASE)

/** Shapes the GitHub API response into what the update UI needs. */
fun parseRelease(json: String): LatestRelease {
    val o = JSONObject(json)
    val notes = if (o.isNull("body")) "" else o.getString("body")
    val tag = o.getString("tag_name")
    val assets = o.optJSONArray("assets")
    return LatestRelease(
        version = tag.replace(LEADING_V, ""),
        tag = tag,
        pageUrl = o.getString("html_url"),
        notes = notes,
        publishedAt = o.optString("published_at", ""),
        assets = buildList {
            if (assets != null) for (i in 0 until assets.length()) {
                val a = assets.getJSONObject(i)
                add(ReleaseAsset(a.getString("name"), a.getString("browser_download_url"), a.optLong("size", -1L)))
            }
        },
        important = IMPORTANT.containsMatchIn(notes),
    )
}

/**
 * A few bullet points for a compact prompt, without markdown: the release's
 * hand-written highlights when it has them, otherwise the first lines of the
 * generated changelog.
 */
fun releaseSummary(notes: String, maxLines: Int = 4): List<String> {
    fun section(title: String): String? {
        val start = notes.indexOf(title)
        if (start < 0) return null
        val rest = notes.substring(start + title.length)
        val end = rest.indexOf("\n## ")
        return if (end >= 0) rest.substring(0, end) else rest
    }
    val body = section("## Highlights") ?: section("## What's changed") ?: ""
    return body.split("\n")
        .map { it.trim() }
        .filter { it.startsWith("- ") }
        .map {
            it.substring(2)
                .replace("**", "")
                .replace("`", "")
                .replace(Regex("\\s\\([0-9a-f]{7}\\)$"), "")
        }
        .take(maxLines)
}

private val RECEIVER_APK = Regex("^relay-receiver-.+\\.apk$")

/** The receiver's APK among a release's assets, or null when the release has none. */
fun selectApk(release: LatestRelease): ReleaseAsset? = release.assets.firstOrNull { RECEIVER_APK.matches(it.name) }

/** The checksum list published next to the artifacts, if any. */
fun selectChecksums(release: LatestRelease): ReleaseAsset? = release.assets.firstOrNull { it.name == "SHA256SUMS.txt" }

/** Finds [fileName] in a `sha256sum` listing ("<hex>  name" or "<hex> *name"); lowercase hex, or null. */
fun parseChecksum(sums: String, fileName: String): String? =
    sums.lineSequence()
        .map { it.trim().split(Regex("\\s+"), limit = 2) }
        .firstOrNull { it.size == 2 && it[1].removePrefix("*") == fileName }
        ?.get(0)?.lowercase()

/** The API url to query: a debug-build-only override, otherwise the real one. Release builds ignore [override]. */
fun resolveApiUrl(debuggable: Boolean, override: String?): String =
    if (debuggable && !override.isNullOrBlank()) override.trim() else LATEST_RELEASE_API
