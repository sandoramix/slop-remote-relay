package dev.sandoramix.skipper.screen.actions

import dev.sandoramix.skipper.screen.core.Command
import dev.sandoramix.skipper.screen.core.ExecResult
import dev.sandoramix.skipper.screen.core.ExecutorId

/**
 * One way of making something happen on the device.
 *
 * The chain exists so that a command is not tied to a mechanism: "seek forward
 * 30 seconds" is satisfied by a media session if one is available, by tapping if
 * not, and by Shizuku when the user has set it up. ShizukuExecutor was added
 * exactly that way: one class implementing this interface, one line in the
 * chain built by RelayForegroundService.
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
class ExecutorChain(
    private val executors: List<ActionExecutor>,
    /**
     * Resolved per call so the receiver language applies live, and per command
     * so it can say what is missing (navigation only exists through accessibility).
     */
    private val noExecutorDetail: (Command) -> String,
    /**
     * Runs before every command; a web player that waits for a click is started
     * here (AccessibilityExecutor.ensurePlayer). Not an executor of its own: it
     * does not complete the command, it makes it possible.
     */
    private val prepare: suspend (Command) -> Prepared = { Prepared.Ready },
) {

    suspend fun run(command: Command): ExecResult {
        val note = when (val prepared = prepare(command)) {
            is Prepared.Answer -> return prepared.result
            is Prepared.Started -> prepared.note
            Prepared.Ready -> null
        }
        val result = runChain(command)
        if (note == null) return result
        return result.copy(detail = listOfNotNull(note, result.detail).joinToString(" · "))
    }

    private suspend fun runChain(command: Command): ExecResult {
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
            detail = noExecutorDetail(command),
        )
    }

    fun available(): List<ExecutorId> =
        executors.filter { it.isAvailable() }.map { it.id }
}

/** What [ExecutorChain]'s prepare step decided before a command. */
sealed interface Prepared {
    /** Nothing to do: run the command. */
    data object Ready : Prepared

    /** A player was started; run the command, and say so in its ack ([note]). */
    data class Started(val note: String) : Prepared

    /** Answered here, without running the command: "play" that started the player, or a failure. */
    data class Answer(val result: ExecResult) : Prepared
}
