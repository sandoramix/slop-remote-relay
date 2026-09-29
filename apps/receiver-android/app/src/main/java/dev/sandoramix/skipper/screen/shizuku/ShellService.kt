package dev.sandoramix.skipper.screen.shizuku

import kotlin.system.exitProcess

/**
 * Lives in a process Shizuku starts with shell (adb) privileges. That is what
 * lets `input keyevent` reach another app's window, and `settings put` change
 * rotation without WRITE_SETTINGS.
 *
 * It takes an argv, never a command line: nothing here goes through `sh -c`,
 * so no string from the network or from recipes.json can smuggle in a second
 * command. ShizukuExecutor is the only caller and only builds fixed templates.
 */
class ShellService : IShellService.Stub() {

    override fun destroy() {
        exitProcess(0)
    }

    override fun run(argv: Array<String>): String {
        val process = ProcessBuilder(*argv).redirectErrorStream(true).start()
        val output = process.inputStream.bufferedReader().use { it.readText() }
        val code = process.waitFor()
        return "$code\n$output"
    }
}
