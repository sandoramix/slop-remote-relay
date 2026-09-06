package com.relay.receiver.actions

import android.content.ComponentName
import android.content.Context
import android.media.session.MediaController
import android.media.session.MediaSessionManager
import android.media.session.PlaybackState
import android.os.SystemClock
import android.util.Log
import android.view.KeyEvent
import com.relay.receiver.core.Command
import com.relay.receiver.core.ExecResult
import com.relay.receiver.core.ExecutorId
import com.relay.receiver.service.RelayNotificationListener

/**
 * Preferred executor for anything playback related.
 *
 * Why this beats tapping the screen: seeking through MediaSession is exact to the
 * millisecond, survives UI redesigns of the target app, works with the screen off
 * and with the controls hidden, and needs no gesture dispatch at all. YouTube and
 * Chromium-based browsers (Brave included) both publish a session with seek
 * support, which covers the two targets in the brief.
 *
 * The permission it needs is Notification Listener, not Accessibility — worth
 * noting, because it means seeking keeps working even on a device where the
 * accessibility service has been revoked.
 */
class MediaSessionExecutor(private val context: Context) : ActionExecutor {

    override val id = ExecutorId.MEDIASESSION

    private val sessionManager: MediaSessionManager? =
        context.getSystemService(Context.MEDIA_SESSION_SERVICE) as? MediaSessionManager

    private val listenerComponent =
        ComponentName(context, RelayNotificationListener::class.java)

    override fun isAvailable(): Boolean =
        sessionManager != null && RelayNotificationListener.isBound

    override fun canHandle(command: Command): Boolean = when (command) {
        is Command.Seek, is Command.PlayPause -> activeController() != null
        else -> false
    }

    override suspend fun execute(command: Command): ExecResult = when (command) {
        is Command.Seek -> seek(command.deltaMs)
        is Command.PlayPause -> playPause(command.play)
        else -> ExecResult.notHandled(id)
    }

    /**
     * Picks the session to drive. When several apps hold one (a browser tab and a
     * music app, say), the system returns them ordered with the most recently
     * active first, and we take the first that is actually playing — falling back
     * to the first that reports a duration.
     */
    fun activeController(): MediaController? {
        val sessions = try {
            sessionManager?.getActiveSessions(listenerComponent).orEmpty()
        } catch (e: SecurityException) {
            // Thrown when the notification listener has been revoked out from
            // under us. Not fatal: the chain falls through to accessibility.
            Log.w(TAG, "No notification listener access", e)
            return null
        }

        return sessions.firstOrNull { it.playbackState?.state == PlaybackState.STATE_PLAYING }
            ?: sessions.firstOrNull { it.metadata != null }
    }

    /**
     * Current playhead. PlaybackState.position is a snapshot taken at
     * lastPositionUpdateTime, so it must be extrapolated forward by the elapsed
     * time times the playback speed. Skip this and every seek lands a few hundred
     * milliseconds off — enough to be noticeable on a 10-second jump.
     */
    private fun currentPositionMs(state: PlaybackState): Long {
        if (state.state != PlaybackState.STATE_PLAYING) return state.position
        val elapsed = SystemClock.elapsedRealtime() - state.lastPositionUpdateTime
        return state.position + (elapsed * state.playbackSpeed).toLong()
    }

    private fun seek(deltaMs: Long): ExecResult {
        val controller = activeController() ?: return ExecResult.notHandled(id)
        val state = controller.playbackState ?: return ExecResult.notHandled(id)

        val supportsSeek = state.actions and PlaybackState.ACTION_SEEK_TO != 0L
        if (supportsSeek) {
            val duration = controller.metadata
                ?.getLong(android.media.MediaMetadata.METADATA_KEY_DURATION)
                ?.takeIf { it > 0 }

            var target = currentPositionMs(state) + deltaMs
            target = target.coerceAtLeast(0L)
            if (duration != null) target = target.coerceAtMost(duration - 250)

            controller.transportControls.seekTo(target)
            return ExecResult.ok(id, "seekTo ${target}ms on ${controller.packageName}")
        }

        // Some sessions expose only the coarse fast-forward/rewind actions, whose
        // step size is decided by the app. Less precise, still better than tapping.
        val key = if (deltaMs >= 0) KeyEvent.KEYCODE_MEDIA_FAST_FORWARD
        else KeyEvent.KEYCODE_MEDIA_REWIND
        val supportsKey = state.actions and
            (PlaybackState.ACTION_FAST_FORWARD or PlaybackState.ACTION_REWIND) != 0L
        if (!supportsKey) return ExecResult.notHandled(id)

        controller.dispatchMediaButtonEvent(KeyEvent(KeyEvent.ACTION_DOWN, key))
        controller.dispatchMediaButtonEvent(KeyEvent(KeyEvent.ACTION_UP, key))
        return ExecResult.ok(id, "media key on ${controller.packageName} (imprecise)")
    }

    private fun playPause(play: Boolean?): ExecResult {
        val controller = activeController() ?: return ExecResult.notHandled(id)
        val playing = controller.playbackState?.state == PlaybackState.STATE_PLAYING
        val shouldPlay = play ?: !playing

        if (shouldPlay) controller.transportControls.play()
        else controller.transportControls.pause()

        return ExecResult.ok(id, if (shouldPlay) "play" else "pause")
    }

    /** Snapshot used by device.status so the controller can render progress. */
    fun snapshot(): MediaSnapshot? {
        val controller = activeController() ?: return null
        val state = controller.playbackState ?: return null
        return MediaSnapshot(
            packageName = controller.packageName,
            positionMs = currentPositionMs(state),
            durationMs = controller.metadata
                ?.getLong(android.media.MediaMetadata.METADATA_KEY_DURATION)
                ?.takeIf { it > 0 },
            isPlaying = state.state == PlaybackState.STATE_PLAYING,
        )
    }

    data class MediaSnapshot(
        val packageName: String,
        val positionMs: Long,
        val durationMs: Long?,
        val isPlaying: Boolean,
    )

    private companion object {
        const val TAG = "MediaSessionExecutor"
    }
}
