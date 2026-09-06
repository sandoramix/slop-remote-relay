package com.relay.receiver

import com.relay.receiver.core.Codec
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
 */
class CodecTest {

    @Test
    fun `canonical form matches the TypeScript vectors`() {
        val cases = listOf(
            """{"v":1,"id":"11111111-2222-4333-8444-555555555555","ts":1757030400000,"type":"cmd","cmd":{"op":"playback.seek","deltaMs":30000},"critical":true}""" to
                """{"cmd":{"deltaMs":30000,"op":"playback.seek"},"critical":true,"id":"11111111-2222-4333-8444-555555555555","ts":1757030400000,"type":"cmd","v":1}""",

            """{"v":1,"id":"aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee","ts":1757030400000,"type":"cmd","cmd":{"op":"fullscreen.enter","toggle":true}}""" to
                """{"cmd":{"op":"fullscreen.enter","toggle":true},"id":"aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee","ts":1757030400000,"type":"cmd","v":1}""",

            """{"v":1,"id":"00000000-0000-4000-8000-000000000000","ts":1757030400000,"type":"cmd","cmd":{"op":"playback.seek","deltaMs":-10000}}""" to
                """{"cmd":{"deltaMs":-10000,"op":"playback.seek"},"id":"00000000-0000-4000-8000-000000000000","ts":1757030400000,"type":"cmd","v":1}""",
        )

        for ((input, expected) in cases) {
            assertEquals(expected, Codec.canonicalize(JSONObject(input)))
        }
    }

    @Test
    fun `pair code derivations are stable`() {
        // These two must match secretFromPairCode and roomFromPairCode in the
        // controller. Same input, same output, forever.
        val secret = Codec.secretFromPairCode("cielo-lento-42")
        val room = Codec.roomFromPairCode("cielo-lento-42")
        assertEquals(64, secret.length)
        assertEquals(24, room.length)
        assertTrue(secret != room)
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
}
