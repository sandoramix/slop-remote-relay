package com.relay.receiver.actions

import com.relay.receiver.core.Command
import com.relay.receiver.core.ExecResult
import com.relay.receiver.core.ExecutorId

/**
 * One way of making something happen on the device.
 *
 * The chain exists so that a command is not tied to a mechanism: "seek forward
 * 30 seconds" is satisfied by a media session if one is available, by tapping if
 * not, and later by Shizuku if the user decides to enable it. Adding Shizuku is
 * one new class implementing this interface plus one line in ExecutorChain.
 */
interface ActionExecutor {
    val id: ExecutorId

    /** Permission/binding state. Reported to the controller in device.status. */
    fun isAvailable(): Boolean

    /** Cheap pre-check. Avoids waking a mechanism that obviously cannot help. */
    fun canHandle(command: Command): Boolean

    suspend fun execute(command: Command): ExecResult
}

/**
 * Tries each executor in order and returns the first that handles the command.
 *
 * Order is preference, not capability: MediaSession first because it is exact
 * and invisible, accessibility second because it works on anything but is
 * fragile, Shizuku last (when enabled) because it is the most powerful and the
 * most demanding to set up.
 */
class ExecutorChain(private val executors: List<ActionExecutor>) {

    suspend fun run(command: Command): ExecResult {
        var lastFailure: ExecResult? = null

        for (executor in executors) {
            if (!executor.isAvailable() || !executor.canHandle(command)) continue
            val result = executor.execute(command)
            if (result.handled && result.ok) return result
            if (result.handled) lastFailure = result
        }

        return lastFailure ?: ExecResult(
            handled = false,
            ok = false,
            executor = null,
            detail = "Nessun esecutore disponibile per questo comando",
        )
    }

    fun available(): List<ExecutorId> =
        executors.filter { it.isAvailable() }.map { it.id }
}
