package dev.sandoramix.skipper.screen.core

import android.content.Context
import android.os.Build
import android.util.Log
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.Executors

/**
 * The receiver's own log: what the app did, kept on the device so a person can
 * send it to the developer. logcat is not an option for them (it needs a cable)
 * and does not survive the days a receiver stays up.
 *
 * Same call shape as [android.util.Log], so a line costs the same to write
 * everywhere. Lines go to logcat and, from [INFO] up and every debug line, to a
 * file that rotates at [MAX_BYTES] and keeps one older generation. Verbose lines
 * (the status loop's, every few seconds) stay in logcat only.
 *
 * What identifies a pairing (the code, its secret, its room) is registered with
 * [hide] at bootstrap and replaced in every line, so a log can be posted in a
 * public issue.
 */
object AppLog {
    private const val MAX_BYTES = 256 * 1024
    private const val MASK = "‹hidden›"

    private val io = Executors.newSingleThreadExecutor { r -> Thread(r, "applog").apply { isDaemon = true } }
    private val stamp = object : ThreadLocal<SimpleDateFormat>() {
        override fun initialValue() = SimpleDateFormat("MM-dd HH:mm:ss.SSS", Locale.US)
    }

    @Volatile private var dir: File? = null
    @Volatile private var hidden: List<String> = emptyList()

    /** Idempotent: every entry point (service, activity, accessibility) calls it. */
    fun init(context: Context) {
        if (dir != null) return
        synchronized(this) {
            if (dir != null) return
            dir = File(context.applicationContext.filesDir, "log").apply { mkdirs() }
            val previous = Thread.getDefaultUncaughtExceptionHandler()
            Thread.setDefaultUncaughtExceptionHandler { thread, error ->
                // Written on this thread: the process is about to die.
                append(format('E', "Crash", "uncaught on ${thread.name}", error))
                previous?.uncaughtException(thread, error)
            }
        }
    }

    /** Values that must never reach the log (pair code, secret, room). Blank ones are ignored. */
    fun hide(vararg values: String?) {
        hidden = hidden + values.filterNotNull().filter { it.length >= 4 }
    }

    fun v(tag: String, msg: String, tr: Throwable? = null) { Log.v(tag, msg, tr) }
    fun d(tag: String, msg: String, tr: Throwable? = null) = emit(Log.DEBUG, tag, msg, tr)
    fun i(tag: String, msg: String, tr: Throwable? = null) = emit(Log.INFO, tag, msg, tr)
    fun w(tag: String, msg: String, tr: Throwable? = null) = emit(Log.WARN, tag, msg, tr)
    fun e(tag: String, msg: String, tr: Throwable? = null) = emit(Log.ERROR, tag, msg, tr)

    private fun emit(priority: Int, tag: String, msg: String, tr: Throwable?) {
        Log.println(priority, tag, if (tr == null) msg else msg + "\n" + Log.getStackTraceString(tr))
        if (dir == null) return
        val line = format("??VDIWE"[priority.coerceIn(0, 6)], tag, msg, tr)
        io.execute { append(line) }
    }

    private fun format(level: Char, tag: String, msg: String, tr: Throwable?): String {
        val text = if (tr == null) msg else msg + "\n" + Log.getStackTraceString(tr).trimEnd()
        return "${stamp.get()!!.format(Date())} $level/$tag: ${scrub(text)}\n"
    }

    private fun scrub(text: String): String = hidden.fold(text) { acc, secret -> acc.replace(secret, MASK) }

    @Synchronized
    private fun append(line: String) {
        val base = dir ?: return
        try {
            val current = File(base, "skipper.log")
            if (current.length() > MAX_BYTES) {
                val old = File(base, "skipper.1.log")
                old.delete()
                current.renameTo(old)
            }
            current.appendText(line)
        } catch (_: Exception) {
            // A log that cannot be written is not worth failing the action over.
        }
    }

    /** The log as one text, oldest first, newest [maxChars] kept; empty before [init]. */
    fun read(maxChars: Int = 120_000): String {
        val base = dir ?: return ""
        io.submit {}.get() // let queued lines land first
        val text = listOf("skipper.1.log", "skipper.log")
            .mapNotNull { File(base, it).takeIf { f -> f.exists() }?.readText() }
            .joinToString("")
        return if (text.length > maxChars) text.takeLast(maxChars).substringAfter('\n') else text
    }

    fun clear() {
        val base = dir ?: return
        io.submit {}.get()
        File(base, "skipper.log").delete()
        File(base, "skipper.1.log").delete()
    }

    /** What a developer needs first: app, device, and what the receiver has been granted. */
    fun report(context: Context, versionName: String, state: Map<String, String>): String = buildString {
        appendLine("Skipper receiver $versionName")
        appendLine("Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT}), ${Build.MANUFACTURER} ${Build.MODEL}")
        appendLine("Language ${context.chosenLanguage()}")
        state.forEach { (k, v) -> appendLine("$k: $v") }
        appendLine("---")
        append(read())
    }
}
