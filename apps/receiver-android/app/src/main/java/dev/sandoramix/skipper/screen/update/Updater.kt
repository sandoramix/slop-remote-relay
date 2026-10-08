package dev.sandoramix.skipper.screen.update

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageInstaller
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import dev.sandoramix.skipper.screen.R
import dev.sandoramix.skipper.screen.core.str
import dev.sandoramix.skipper.screen.service.RelayForegroundService
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.Executors

sealed interface UpdateState {
    data object Idle : UpdateState
    data object Checking : UpdateState
    data object UpToDate : UpdateState
    data class Available(val release: LatestRelease) : UpdateState
    /** The user asked to update but "install unknown apps" is not granted yet; resumes on return. */
    data class NeedsPermission(val release: LatestRelease) : UpdateState
    data class Downloading(val release: LatestRelease, val done: Long, val total: Long) : UpdateState
    data class ReadyToInstall(val release: LatestRelease) : UpdateState
    data class Installing(val release: LatestRelease) : UpdateState
    /** [release] is set when the update can be retried. */
    data class Failed(val message: String, val release: LatestRelease? = null) : UpdateState
}

/**
 * Checks GitHub for a newer release, downloads its APK and hands it to the
 * system installer. One instance per process, driven only from the UI: the
 * foreground service never touches it. All network and disk work runs on a
 * single background thread; state changes are delivered on the main thread.
 */
class Updater private constructor(private val app: Context) {

    @Volatile var state: UpdateState = UpdateState.Idle
        private set

    /** Set by the activity while it is visible. Called on the main thread. */
    var listener: ((UpdateState) -> Unit)? = null

    private val main = Handler(Looper.getMainLooper())
    private val executor = Executors.newSingleThreadExecutor()
    private val prefs = app.getSharedPreferences(RelayForegroundService.PREFS, Context.MODE_PRIVATE)

    private fun set(s: UpdateState) {
        state = s
        main.post { listener?.invoke(s) }
    }

    fun installedVersion(): String =
        runCatching { app.packageManager.getPackageInfo(app.packageName, 0).versionName }.getOrNull() ?: "0"

    /** True once per [SILENT_INTERVAL_MS]; the timestamp is written by a successful check. */
    fun silentCheckDue(): Boolean = System.currentTimeMillis() - prefs.getLong(KEY_LAST_CHECK, 0L) >= SILENT_INTERVAL_MS

    private fun busy() = state.let { it is UpdateState.Checking || it is UpdateState.Downloading || it is UpdateState.Installing }

    /** The API url in effect: the debug-only pref override, else GitHub. Release builds ignore the pref. */
    fun apiUrl(): String {
        val debuggable = app.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0
        return resolveApiUrl(debuggable, prefs.getString(KEY_API_URL, null))
    }

    /**
     * Looks for a newer release. A [silent] check never reports a failure: it
     * leaves the state as it was. Either way nothing is downloaded.
     */
    fun check(silent: Boolean = false, apiUrl: String = apiUrl()) {
        if (busy()) return
        val before = state
        if (!silent) set(UpdateState.Checking)
        executor.execute {
            try {
                val release = parseRelease(httpGetText(apiUrl, ACCEPT_JSON))
                prefs.edit().putLong(KEY_LAST_CHECK, System.currentTimeMillis()).apply()
                if (compareVersions(release.version, installedVersion()) > 0) {
                    set(UpdateState.Available(release))
                } else {
                    cleanDownloads()
                    set(UpdateState.UpToDate)
                }
            } catch (e: Exception) {
                set(if (silent) before else UpdateState.Failed(app.str(R.string.update_err_network, describe(e))))
            }
        }
    }

    /** The "Download and install" button. [context] starts the unknown-sources settings page when needed. */
    fun startUpdate(context: Context) {
        val release = when (val s = state) {
            is UpdateState.Available -> s.release
            is UpdateState.NeedsPermission -> s.release
            is UpdateState.ReadyToInstall -> s.release
            is UpdateState.Installing -> s.release
            is UpdateState.Failed -> s.release ?: return
            else -> return
        }
        if (!app.packageManager.canRequestPackageInstalls()) {
            set(UpdateState.NeedsPermission(release))
            context.startActivity(
                Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${app.packageName}"))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            )
            return
        }
        executor.execute {
            try {
                val apk = download(release)
                set(UpdateState.ReadyToInstall(release))
                install(release, apk)
            } catch (e: UpdateException) {
                set(UpdateState.Failed(e.message ?: "", release))
            } catch (e: Exception) {
                set(UpdateState.Failed(app.str(R.string.update_err_generic, describe(e)), release))
            }
        }
    }

    /** Called when the activity returns from settings: continues an update that was waiting for the grant. */
    fun resumeAfterPermission(context: Context) {
        if (state is UpdateState.NeedsPermission && app.packageManager.canRequestPackageInstalls()) startUpdate(context)
    }

    // ------------------------------------------------------------------ download

    private class UpdateException(message: String) : Exception(message)

    private fun downloadDir() = File(app.cacheDir, "updates")

    private fun cleanDownloads() {
        downloadDir().listFiles()?.forEach { it.delete() }
    }

    private fun download(release: LatestRelease): File {
        val asset = selectApk(release) ?: throw UpdateException(app.str(R.string.update_err_no_apk))
        cleanDownloads()
        val dir = downloadDir().apply { mkdirs() }
        val part = File(dir, asset.name + ".part")
        val target = File(dir, asset.name)
        set(UpdateState.Downloading(release, 0, asset.size))

        val digest = MessageDigest.getInstance("SHA-256")
        var done = 0L
        var lastPercent = -1
        try {
            httpGetStream(asset.url, "application/octet-stream") { input, length ->
                val total = if (asset.size > 0) asset.size else length
                FileOutputStream(part).use { out ->
                    val buf = ByteArray(64 * 1024)
                    while (true) {
                        val n = input.read(buf)
                        if (n < 0) break
                        out.write(buf, 0, n)
                        digest.update(buf, 0, n)
                        done += n
                        val percent = if (total > 0) (done * 100 / total).toInt() else -1
                        if (percent != lastPercent) {
                            lastPercent = percent
                            set(UpdateState.Downloading(release, done, total))
                        }
                    }
                    out.fd.sync()
                }
            }
        } catch (e: java.io.IOException) {
            part.delete()
            throw UpdateException(app.str(R.string.update_err_download, describe(e)))
        }

        if (asset.size > 0 && part.length() != asset.size) {
            part.delete()
            throw UpdateException(app.str(R.string.update_err_size))
        }
        selectChecksums(release)?.let { sums ->
            val expected = parseChecksum(httpGetText(sums.url, "text/plain"), asset.name)
            val actual = digest.digest().joinToString("") { "%02x".format(it) }
            if (expected != null && expected != actual) {
                part.delete()
                throw UpdateException(app.str(R.string.update_err_checksum))
            }
        }
        if (!part.renameTo(target)) {
            part.delete()
            throw UpdateException(app.str(R.string.update_err_download, "rename"))
        }
        val archive = app.packageManager.getPackageArchiveInfo(target.path, 0)
        if (archive == null || archive.packageName != app.packageName) {
            target.delete()
            throw UpdateException(app.str(R.string.update_err_package))
        }
        return target
    }

    // ------------------------------------------------------------------- install

    private fun install(release: LatestRelease, apk: File) {
        val installer = app.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
        params.setSize(apk.length())
        val id = installer.createSession(params)
        installer.openSession(id).use { session ->
            session.openWrite("relay.apk", 0, apk.length()).use { out ->
                apk.inputStream().use { it.copyTo(out) }
                session.fsync(out)
            }
            val intent = Intent(app, UpdateInstallReceiver::class.java).setAction(UpdateInstallReceiver.ACTION)
            // The system fills in the status extras, so the PendingIntent must be mutable (explicit target, so that is safe).
            val flags = PendingIntent.FLAG_UPDATE_CURRENT or
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0
            val pending = PendingIntent.getBroadcast(app, id, intent, flags)
            set(UpdateState.Installing(release))
            session.commit(pending.intentSender)
        }
    }

    /** From [UpdateInstallReceiver]. Success normally never arrives: the system replaces and kills this process. */
    fun onInstallResult(status: Int, detail: String?) {
        val release = (state as? UpdateState.Installing)?.release
        when (status) {
            PackageInstaller.STATUS_SUCCESS -> {
                cleanDownloads()
                set(UpdateState.Idle)
            }
            else -> {
                val reason = when (status) {
                    PackageInstaller.STATUS_FAILURE_ABORTED -> app.str(R.string.update_inst_aborted)
                    PackageInstaller.STATUS_FAILURE_BLOCKED -> app.str(R.string.update_inst_blocked)
                    PackageInstaller.STATUS_FAILURE_CONFLICT -> app.str(R.string.update_inst_conflict)
                    PackageInstaller.STATUS_FAILURE_INCOMPATIBLE -> app.str(R.string.update_inst_incompatible)
                    PackageInstaller.STATUS_FAILURE_INVALID -> app.str(R.string.update_inst_invalid)
                    PackageInstaller.STATUS_FAILURE_STORAGE -> app.str(R.string.update_inst_storage)
                    else -> app.str(R.string.update_inst_unknown, status)
                }
                set(UpdateState.Failed(app.str(R.string.update_err_install, reason), release))
            }
        }
    }

    // ---------------------------------------------------------------------- http

    private fun describe(e: Exception) = e.message?.takeIf { it.isNotBlank() } ?: e.javaClass.simpleName

    /** GET with manual redirect handling (GitHub asset urls 302 to another host), then [block] on the body. */
    private fun <T> httpGetStream(url: String, accept: String, block: (java.io.InputStream, Long) -> T): T {
        var target = url
        repeat(MAX_REDIRECTS + 1) {
            val c = URL(target).openConnection() as HttpURLConnection
            try {
                c.instanceFollowRedirects = false
                c.connectTimeout = 15_000
                c.readTimeout = 30_000
                c.setRequestProperty("User-Agent", "relay-receiver/${installedVersion()}")
                c.setRequestProperty("Accept", accept)
                val code = c.responseCode
                if (code in 300..399) {
                    val location = c.getHeaderField("Location") ?: throw java.io.IOException("redirect without Location")
                    target = URL(URL(target), location).toString()
                    return@repeat
                }
                if (code != 200) throw java.io.IOException("HTTP $code")
                return c.inputStream.use { block(it, c.contentLengthLong) }
            } finally {
                c.disconnect()
            }
        }
        throw java.io.IOException("too many redirects")
    }

    private fun httpGetText(url: String, accept: String): String =
        httpGetStream(url, accept) { input, _ -> input.readBytes().toString(Charsets.UTF_8) }

    companion object {
        const val KEY_API_URL = "update_api_url"
        const val KEY_LAST_CHECK = "update_last_check"
        private const val SILENT_INTERVAL_MS = 12L * 60 * 60 * 1000
        private const val MAX_REDIRECTS = 5
        private const val ACCEPT_JSON = "application/vnd.github+json"

        @Volatile private var instance: Updater? = null

        fun get(context: Context): Updater =
            instance ?: synchronized(this) { instance ?: Updater(context.applicationContext).also { instance = it } }
    }
}
