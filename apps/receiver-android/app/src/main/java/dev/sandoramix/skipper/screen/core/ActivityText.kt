package dev.sandoramix.skipper.screen.core

import android.content.Context
import dev.sandoramix.skipper.screen.R

/** Human wording for [RelayActivity], shared by the main screen and the notification. */

/** The path's name as the user knows it ("Local Wi-Fi"), or the raw id if it is not one we know. */
fun pathLabel(context: Context, id: String): String = when (id) {
    "lan" -> context.str(R.string.path_lan)
    "webrtc" -> context.str(R.string.path_webrtc)
    "relay" -> context.str(R.string.path_relay)
    "http" -> context.str(R.string.path_http)
    "mqtt" -> context.str(R.string.path_mqtt)
    "ble" -> context.str(R.string.path_ble)
    else -> id
}

/** "1:30" or "1:02:03", the way a player shows a position. */
fun clock(ms: Long): String {
    val total = (ms.coerceAtLeast(0) / 1000)
    val h = total / 3600
    val m = (total % 3600) / 60
    val s = total % 60
    return if (h > 0) "%d:%02d:%02d".format(h, m, s) else "%d:%02d".format(m, s)
}

/** "10 s" under a minute, "1:30" above: the size of a skip. */
private fun amount(ms: Long): String {
    val abs = kotlin.math.abs(ms)
    return if (abs < 60_000) "${abs / 1000} s" else clock(abs)
}

/** What a command does, in one short phrase. */
fun describeCommand(context: Context, command: Command): String = when (command) {
    is Command.Fullscreen ->
        context.str(if (command.toggle) R.string.act_fullscreen_toggle else R.string.act_fullscreen_on)
    Command.FullscreenExit -> context.str(R.string.act_fullscreen_exit)
    is Command.Seek ->
        context.str(if (command.deltaMs >= 0) R.string.act_seek_forward else R.string.act_seek_back, amount(command.deltaMs))
    is Command.SeekTo -> context.str(R.string.act_seek_to, clock(command.positionMs))
    is Command.PlayPause -> context.str(
        when (command.play) {
            null -> R.string.act_play_pause
            true -> R.string.act_play
            false -> R.string.act_pause
        },
    )
    is Command.NavStep -> context.str(if (command.delta > 0) R.string.act_next else R.string.act_previous)
    is Command.NavGoto -> context.str(R.string.act_goto, command.label)
    is Command.Status -> ""
}

/** "3 s" or "2 min": how long ago something happened. */
fun ago(context: Context, ms: Long): String {
    val s = (ms.coerceAtLeast(0) / 1000).toInt()
    return if (s < 60) context.str(R.string.act_ago_s, s) else context.str(R.string.act_ago_min, s / 60)
}
