package com.relay.receiver.shizuku

import android.content.ComponentName
import android.content.Context
import android.content.ServiceConnection
import android.content.pm.PackageManager
import android.os.IBinder
import android.util.Log
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.withTimeoutOrNull
import rikka.shizuku.Shizuku

/**
 * Connection to Shizuku and to our ShellService inside it.
 *
 * Shizuku is optional by design: it needs wireless debugging and a manual
 * restart after every reboot, so the receiver must work without it and pick it
 * up whenever it appears. Everything here fails soft and reports "unavailable".
 */
object ShizukuBridge {

    private const val TAG = "ShizukuBridge"
    const val REQUEST_CODE = 4712

    @Volatile private var shell: IShellService? = null
    private var binding: CompletableDeferred<IShellService?>? = null

    private val args by lazy {
        Shizuku.UserServiceArgs(ComponentName("com.relay.receiver", ShellService::class.java.name))
            .daemon(false)
            .processNameSuffix("shell")
            .debuggable(false)
            .version(1)
    }

    private val connection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName, service: IBinder) {
            val s = IShellService.Stub.asInterface(service)
            shell = s
            binding?.complete(s)
        }

        override fun onServiceDisconnected(name: ComponentName) {
            shell = null
        }
    }

    /** Shizuku is running and the binder answers. */
    fun running(): Boolean = runCatching { Shizuku.pingBinder() }.getOrDefault(false)

    fun granted(): Boolean = running() && runCatching {
        !Shizuku.isPreV11() && Shizuku.checkSelfPermission() == PackageManager.PERMISSION_GRANTED
    }.getOrDefault(false)

    fun available(): Boolean = granted()

    /** Shows Shizuku's own permission dialog. Call from an activity. */
    fun requestPermission() {
        if (running() && !granted()) runCatching { Shizuku.requestPermission(REQUEST_CODE) }
    }

    fun state(context: Context): String = when {
        !isInstalled(context) -> "Shizuku non installato"
        !running() -> "Shizuku installato ma non avviato"
        !granted() -> "Shizuku avviato, permesso non concesso"
        else -> "Shizuku pronto"
    }

    private fun isInstalled(context: Context): Boolean = runCatching {
        context.packageManager.getPackageInfo("moe.shizuku.privileged.api", 0)
        true
    }.getOrDefault(false)

    private suspend fun service(): IShellService? {
        shell?.let { if (it.asBinder().isBinderAlive) return it }
        if (!granted()) return null
        val pending = CompletableDeferred<IShellService?>()
        binding = pending
        runCatching { Shizuku.bindUserService(args, connection) }
            .onFailure {
                Log.w(TAG, "bindUserService failed", it)
                return null
            }
        return withTimeoutOrNull(5_000) { pending.await() }
    }

    /** Runs one argv with shell privileges. Returns exit code and output, or null. */
    suspend fun run(vararg argv: String): Pair<Int, String>? {
        val s = service() ?: return null
        return runCatching {
            val raw = s.run(arrayOf(*argv))
            val code = raw.substringBefore('\n').toIntOrNull() ?: -1
            code to raw.substringAfter('\n')
        }.onFailure { Log.w(TAG, "shell call failed", it) }.getOrNull()
    }
}
