package dev.sandoramix.skipper.screen.recipes

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * Per-app strategies for actions that have no system API.
 *
 * Fullscreen is the case that forced this to exist: Android offers nothing to
 * request it, so each target app needs its own route in, and those routes break
 * whenever the app redesigns its player. Keeping them as data rather than code
 * means a broken YouTube recipe is a JSON edit, not a release.
 *
 * Steps are tried in order until one reports success. The last step in every
 * list should be something that cannot fail on layout changes — a learned tap or
 * a rotation — so the feature degrades instead of dying.
 */
sealed interface Step {

    /** Find a node in the accessibility tree and click it. The good path. */
    data class Node(
        /** Matched against contentDescription, case-insensitive, any locale. */
        val descriptions: List<String> = emptyList(),
        /** Matched against viewIdResourceName, e.g. com.pkg:id/fullscreen_button. */
        val viewIds: List<String> = emptyList(),
        /** Some controls are only clickable on an ancestor. Walk up this far. */
        val climb: Int = 2,
    ) : Step

    /** Tap at a normalised coordinate to reveal hidden controls, then retry. */
    data class Reveal(val x: Float, val y: Float, val settleMs: Long = 450) : Step

    /** Dispatch a gesture at a normalised coordinate. The learned-tap fallback. */
    data class Tap(val x: Float, val y: Float, val double: Boolean = false) : Step

    /**
     * Force landscape via Settings.System. YouTube enters its fullscreen player
     * on its own when rotated, so this is a fullscreen route that needs no
     * accessibility service at all.
     */
    data class Rotate(val landscape: Boolean) : Step

    /** Delegate to the media session layer (used by seek recipes). */
    data object MediaSession : Step

    /**
     * System Back. Every fullscreen player we target — YouTube, and the
     * Fullscreen API in Chrome and Brave — leaves fullscreen on Back, which makes
     * this the one exit route that does not depend on finding a control.
     */
    data object Back : Step

    /**
     * A key event, e.g. KEYCODE_F or KEYCODE_ESCAPE for a web player. Only the
     * Shizuku executor can inject keys into another app; accessibility skips it.
     */
    data class Key(val code: String) : Step
}

/**
 * How to tell that the foreground app is already fullscreen, which is what makes
 * a toggle possible. Any one match is enough.
 */
data class FullscreenMarkers(
    /** A visible node whose label contains one of these means "fullscreen now". */
    val present: List<String> = emptyList(),
    /** View ids that exist only outside fullscreen (a browser's URL bar). */
    val absentViewIds: List<String> = emptyList(),
)

data class Recipe(
    val packageName: String,
    val fullscreen: List<Step>,
    val seek: List<Step>,
    val exitFullscreen: List<Step> = emptyList(),
    val markers: FullscreenMarkers? = null,
    /** Episode navigation plans, for browsers (see Navigation.kt). */
    val nav: BrowserNav? = null,
    /** How to start a player that waits for a click, for browsers (see PlayerStart.kt). */
    val start: BrowserStart? = null,
    /**
     * How a web element is pressed, in order, each verified before the next:
     * "click" (ACTION_CLICK) and/or "tap" (a real gesture at its centre).
     */
    val press: List<String> = RecipeEngine.DEFAULT_PRESS,
)

class RecipeEngine(context: Context) {

    private val recipes: Map<String, Recipe> = loadBundled(context) + loadLearned(context)

    fun forPackage(packageName: String?): Recipe? =
        packageName?.let { recipes[it] }

    fun knows(packageName: String?): Boolean = forPackage(packageName) != null

    fun navFor(packageName: String?): BrowserNav? = forPackage(packageName)?.nav

    fun startFor(packageName: String?): BrowserStart? = forPackage(packageName)?.start

    fun pressOrderFor(packageName: String?): List<String> = forPackage(packageName)?.press ?: DEFAULT_PRESS

    /** The start section's own address bar ids, else the nav section's. */
    fun urlBarFor(packageName: String?): List<String> {
        val recipe = forPackage(packageName) ?: return emptyList()
        return recipe.start?.urlBarViewIds?.takeIf { it.isNotEmpty() }
            ?: recipe.nav?.urlBarViewIds.orEmpty()
    }

    /** Every app gets these when it has no recipe of its own. */
    fun fallbackFullscreen(): List<Step> = listOf(
        Step.Reveal(x = 0.5f, y = 0.32f),
        Step.Node(
            descriptions = listOf(
                "schermo intero", "full screen", "fullscreen",
                "pantalla completa", "plein écran", "vollbild",
            ),
        ),
        Step.Rotate(landscape = true),
    )

    fun fallbackExitFullscreen(): List<Step> = listOf(Step.Back)

    fun fallbackMarkers(): FullscreenMarkers = FullscreenMarkers(
        present = listOf(
            "esci da schermo intero", "exit full screen", "exit fullscreen",
            "salir de pantalla completa", "quitter le mode plein écran", "vollbildmodus beenden",
        ),
    )

    /**
     * Same for seek. MediaSession first as a statement of preference — the
     * executor chain has already tried it by the time anything reads this — then
     * the coarse double-tap on the right-hand side of the player, which is the
     * gesture YouTube and every web player built on it share.
     */
    fun fallbackSeek(): List<Step> = listOf(
        Step.MediaSession,
        Step.Tap(x = 0.85f, y = 0.5f, double = true),
    )

    // ------------------------------------------------------------------ loading

    private fun loadBundled(context: Context): Map<String, Recipe> = try {
        val json = context.assets.open(ASSET).bufferedReader().use { it.readText() }
        parse(JSONObject(json))
    } catch (e: Exception) {
        emptyMap()
    }

    /**
     * Recipes recorded by the user through the learning flow in MainActivity:
     * they open the target app on the receiver, tap where the fullscreen button
     * is, and the coordinate is stored here as a Tap step.
     */
    private fun loadLearned(context: Context): Map<String, Recipe> {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val raw = prefs.getString(KEY_LEARNED, null) ?: return emptyMap()
        return try {
            parse(JSONObject(raw))
        } catch (e: Exception) {
            emptyMap()
        }
    }

    private fun parse(root: JSONObject): Map<String, Recipe> = buildMap {
        for (packageName in root.keys()) {
            val entry = root.getJSONObject(packageName)
            put(
                packageName,
                Recipe(
                    packageName = packageName,
                    fullscreen = parseSteps(entry.optJSONArray("fullscreen")),
                    seek = parseSteps(entry.optJSONArray("seek")),
                    exitFullscreen = parseSteps(entry.optJSONArray("exitFullscreen")),
                    markers = entry.optJSONObject("fullscreenMarkers")?.let {
                        FullscreenMarkers(
                            present = it.optJSONArray("present").toStringList(),
                            absentViewIds = it.optJSONArray("absentViewIds").toStringList(),
                        )
                    },
                    nav = entry.optJSONObject("nav")?.let(::parseNav),
                    start = entry.optJSONObject("start")?.let(::parseStart),
                    press = parsePress(entry.optJSONArray("press")) ?: DEFAULT_PRESS,
                ),
            )
        }
    }

    /**
     * A broken site entry (bad regex, missing field) is skipped on its own, so
     * one typo cannot take navigation down for every other site.
     */
    private fun parseNav(o: JSONObject): BrowserNav {
        val sites = o.optJSONArray("sites")
        return BrowserNav(
            urlBarViewIds = o.optJSONArray("urlBarViewIds").toStringList(),
            sites = (0 until (sites?.length() ?: 0)).mapNotNull { i ->
                runCatching {
                    val s = sites!!.getJSONObject(i)
                    fun rx(key: String) = s.optString(key).takeIf { it.isNotEmpty() }?.let(::Regex)
                    NavPlan(
                        site = s.getString("site"),
                        url = rx("url"),
                        title = rx("title"),
                        current = Regex(s.getString("current")),
                        currentNode = s.optString("currentNode").takeIf { it.isNotEmpty() },
                        list = s.getString("list"),
                        itemLabel = rx("itemLabel"),
                        ranges = rx("ranges"),
                        prev = rx("prev"),
                        next = rx("next"),
                    )
                }.getOrNull()
            },
        )
    }

    /** Same rule as nav: a broken site entry is skipped on its own. */
    private fun parseStart(o: JSONObject): BrowserStart {
        val sites = o.optJSONArray("sites")
        return BrowserStart(
            urlBarViewIds = o.optJSONArray("urlBarViewIds").toStringList(),
            sites = (0 until (sites?.length() ?: 0)).mapNotNull { i ->
                runCatching {
                    val s = sites!!.getJSONObject(i)
                    fun rx(key: String) = s.optString(key).takeIf { it.isNotEmpty() }?.let(::Regex)
                    val control = parseMatcher(s.getJSONObject("control"))
                    require(!control.isEmpty) { "start.control matches nothing" }
                    StartPlan(
                        site = s.getString("site"),
                        url = rx("url"),
                        title = rx("title"),
                        control = control,
                        climb = s.getJSONObject("control").optInt("climb", 2),
                        notStarted = s.optJSONObject("notStarted")?.let(::parseMatcher) ?: control,
                        started = s.optJSONObject("started")?.let(::parseMatcher),
                        play = s.optJSONObject("play")?.let(::parseMatcher),
                        press = parsePress(s.optJSONArray("press")),
                        waitMs = s.optLong("waitMs", 6_000),
                        pollMs = s.optLong("pollMs", 300).coerceAtLeast(50),
                    )
                }.getOrNull()
            },
        )
    }

    /** Known methods only, in order; null when none is given. */
    private fun parsePress(array: JSONArray?): List<String>? =
        array.toStringList().filter { it == "click" || it == "tap" }.distinct().ifEmpty { null }

    private fun parseMatcher(o: JSONObject) = NodeMatcher(
        viewIds = o.optJSONArray("viewIds").toStringList(),
        labels = o.optJSONArray("labels").toStringList(),
        contains = o.optJSONArray("contains").toStringList(),
        within = o.optString("within").takeIf { it.isNotEmpty() },
    )

    private fun parseSteps(array: JSONArray?): List<Step> {
        if (array == null) return emptyList()
        return (0 until array.length()).mapNotNull { i ->
            val o = array.getJSONObject(i)
            when (o.getString("kind")) {
                "node" -> Step.Node(
                    descriptions = o.optJSONArray("descriptions").toStringList(),
                    viewIds = o.optJSONArray("viewIds").toStringList(),
                    climb = o.optInt("climb", 2),
                )
                "reveal" -> Step.Reveal(
                    x = o.getDouble("x").toFloat(),
                    y = o.getDouble("y").toFloat(),
                    settleMs = o.optLong("settleMs", 450),
                )
                "tap" -> Step.Tap(
                    x = o.getDouble("x").toFloat(),
                    y = o.getDouble("y").toFloat(),
                    double = o.optBoolean("double", false),
                )
                "rotate" -> Step.Rotate(landscape = o.optBoolean("landscape", true))
                "mediasession" -> Step.MediaSession
                "back" -> Step.Back
                "key" -> Step.Key(o.getString("code"))
                else -> null
            }
        }
    }

    private fun JSONArray?.toStringList(): List<String> {
        if (this == null) return emptyList()
        return (0 until length()).map { getString(it) }
    }

    companion object {
        /** Chrome honours ACTION_CLICK on web elements, on screen or not; a tap needs the element in view. */
        val DEFAULT_PRESS = listOf("click", "tap")
        private const val ASSET = "recipes.json"
        const val PREFS = "relay.recipes"
        const val KEY_LEARNED = "learned"
    }
}
