package dev.sandoramix.skipper.screen

import dev.sandoramix.skipper.screen.core.Codec
import dev.sandoramix.skipper.screen.core.Command
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Guards the one contract that will silently break everything: the canonical
 * form must be byte-identical between Kotlin and TypeScript, or every signature
 * fails with nothing but "signature" in a log.
 *
 * Expected strings come from `npm run vectors -w @relay/protocol`. Regenerate
 * and paste them here whenever the envelope shape changes.
 *
 * A note on how these are asserted. Feeding each canonical string back through
 * canonicalize and expecting itself is not a tautology: the string is what
 * JSON.stringify produced, so the round trip only closes if the Kotlin parser
 * and the Kotlin escaper together agree with JavaScript on escaping, key order
 * and number formatting. That is exactly the contract under test.
 */
class CodecTest {

    /** Canonical output of every vector, verbatim from the TypeScript runner. */
    private val vectors = listOf(
        "seek forward" to
            """{"cmd":{"deltaMs":30000,"op":"playback.seek"},"critical":true,"id":"11111111-2222-4333-8444-555555555555","ts":1757030400000,"type":"cmd","v":1}""",

        "fullscreen toggle" to
            """{"cmd":{"op":"fullscreen.enter","toggle":true},"id":"aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee","ts":1757030400000,"type":"cmd","v":1}""",

        "negative seek, no critical flag" to
            """{"cmd":{"deltaMs":-10000,"op":"playback.seek"},"id":"00000000-0000-4000-8000-000000000000","ts":1757030400000,"type":"cmd","v":1}""",

        "ack detail with a slash" to
            """{"detail":"seekTo 61000ms on com.google.android.youtube via wss://relay/room/x </end>","executedBy":"mediasession","id":"11111111-1111-4111-8111-111111111111","ok":true,"ref":"00000000-0000-4000-8000-000000000000","tookMs":12,"ts":1757030400000,"type":"ack","v":1}""",

        "ack detail with quotes, backslashes and control characters" to
            """{"detail":"no \"fullscreen\" node\tin C:\\Users\\x\nline two\u0001\u001f","id":"22222222-2222-4222-8222-222222222222","ok":false,"ref":"00000000-0000-4000-8000-000000000000","tookMs":3,"ts":1757030400000,"type":"ack","v":1}""",

        "event with non-ascii and astral characters" to
            """{"detail":"perché nessuna strategia ha funzionato — 全画面 🎬","event":"error","id":"33333333-3333-4333-8333-333333333333","ts":1757030400000,"type":"event","v":1}""",

        "status event with nulls and an array" to
            """{"event":"status","id":"44444444-4444-4444-8444-444444444444","status":{"batteryPercent":87,"durationMs":null,"executors":["mediasession","accessibility"],"foregroundPackage":null,"hasMediaSession":false,"isPlaying":false,"positionMs":null,"recipeKnown":false},"ts":1757030400000,"type":"event","v":1}""",
        "fullscreen exit" to
            """{"cmd":{"op":"fullscreen.exit"},"id":"55555555-5555-4555-8555-555555555555","ts":1757030400000,"type":"cmd","v":1}""",

        "absolute seek past the 32-bit range" to
            """{"cmd":{"op":"playback.seekTo","positionMs":3000000000},"critical":true,"id":"66666666-6666-4666-8666-666666666666","ts":1757030400000,"type":"cmd","v":1}""",

        "browser status with title and fullscreen" to
            """{"event":"status","id":"77777777-7777-4777-8777-777777777777","status":{"batteryPercent":null,"durationMs":3600000,"executors":["dom","cdp"],"foregroundPackage":"https://www.youtube.com/watch?v=x","fullscreen":false,"hasMediaSession":true,"isPlaying":true,"kind":"browser","positionMs":61000,"recipeKnown":true,"title":"Un \"titolo\" / con — accenti è"},"ts":1757030400000,"type":"event","v":1}""",
    )


    @Test
    fun `canonical form matches the TypeScript vectors`() {
        for ((name, canonical) in vectors) {
            assertEquals(name, canonical, Codec.canonicalize(JSONObject(canonical)))
        }
    }

    @Test
    fun `keys are sorted whatever order they arrive in`() {
        val shuffled =
            """{"v":1,"id":"11111111-2222-4333-8444-555555555555","ts":1757030400000,"type":"cmd","cmd":{"op":"playback.seek","deltaMs":30000},"critical":true}"""
        assertEquals(vectors[0].second, Codec.canonicalize(JSONObject(shuffled)))
    }

    @Test
    fun `sig is stripped at the top level only`() {
        val withSig =
            """{"v":1,"id":"x","ts":1,"type":"cmd","sig":"deadbeef","cmd":{"op":"device.status","sig":"kept"}}"""
        assertEquals(
            """{"cmd":{"op":"device.status","sig":"kept"},"id":"x","ts":1,"type":"cmd","v":1}""",
            Codec.canonicalize(JSONObject(withSig)),
        )
    }

    /**
     * The regression that started all of this. JSONObject.quote escapes '/' —
     * always on AOSP, after '<' in the Maven build used by these tests — and
     * JSON.stringify never does. Any ack mentioning a URL used to be unverifiable.
     */
    @Test
    fun `a forward slash is never escaped`() {
        val canonical = Codec.canonicalize(JSONObject("""{"detail":"wss://relay/room/x </end>"}"""))
        assertEquals("""{"detail":"wss://relay/room/x </end>"}""", canonical)
    }

    @Test
    fun `pair code derivations match the controller`() {
        // Byte-for-byte from the TypeScript runner. Same input, same output, forever.
        assertEquals(
            "c1aa64bff880e5659ab0ab3a136b62d37550a41e27e338d6309846192af6c501",
            Codec.secretFromPairCode("cielo-lento-42"),
        )
        assertEquals(
            "0192d130ee3206a13382f6a8",
            Codec.roomFromPairCode("cielo-lento-42"),
        )
    }

    /** Pins the whole signing path, not just the serialisation feeding it. */
    @Test
    fun `hmac over a canonical envelope matches the TypeScript runner`() {
        val secret = Codec.secretFromPairCode("cielo-lento-42")
        assertEquals(
            "3b11c462d159e68a567857b0dd6e8e5af923771d6de25cc803353290b822f1d8",
            Codec.hmacHex(secret, vectors[0].second),
        )
    }

    @Test
    fun `a tampered frame is rejected`() {
        val secret = Codec.secretFromPairCode("prova")
        val body = JSONObject("""{"v":1,"id":"x","ts":${System.currentTimeMillis()},"type":"cmd","cmd":{"op":"playback.seek","deltaMs":10000}}""")
        body.put("sig", Codec.hmacHex(secret, Codec.canonicalize(body)))

        val valid = Codec.verify(body.toString(), secret)
        assertTrue(valid is Codec.Verdict.Valid)

        // Flip the payload but keep the signature.
        body.getJSONObject("cmd").put("deltaMs", 999_000)
        val tampered = Codec.verify(body.toString(), secret)
        assertTrue(tampered is Codec.Verdict.Rejected)
    }

    @Test
    fun `a frame outside the skew window is rejected`() {
        val secret = Codec.secretFromPairCode("prova")
        val stale = System.currentTimeMillis() - 120_000
        val body = JSONObject("""{"v":1,"id":"y","ts":$stale,"type":"cmd","cmd":{"op":"device.status"}}""")
        body.put("sig", Codec.hmacHex(secret, Codec.canonicalize(body)))

        val verdict = Codec.verify(body.toString(), secret)
        assertTrue(verdict is Codec.Verdict.Rejected)
        assertEquals("skew", (verdict as Codec.Verdict.Rejected).reason)
    }

    @Test
    fun `new ops parse, and positions stay Long`() {
        val exit = Command.fromJson(JSONObject("""{"op":"fullscreen.exit"}"""))
        assertEquals(Command.FullscreenExit, exit)
        val seekTo = Command.fromJson(JSONObject(vectors[8].second).getJSONObject("cmd"))
        assertEquals(Command.SeekTo(3_000_000_000L), seekTo)
    }
}
