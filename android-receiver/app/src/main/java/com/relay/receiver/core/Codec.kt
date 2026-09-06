package com.relay.receiver.core

import org.json.JSONArray
import org.json.JSONObject
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * Signature verification and canonical serialisation.
 *
 * The canonical form must be byte-identical to the TypeScript stableStringify in
 * packages/protocol/src/codec.ts, or nothing will verify. The contract is: keys
 * sorted lexicographically, `sig` excluded, no whitespace, undefined/null keys
 * omitted the same way on both sides. If you change one, change both — there is
 * a round-trip test in the docs that catches drift.
 */
object Codec {

    fun canonicalize(json: JSONObject): String = stableObject(json, skip = "sig")

    private fun stableObject(value: JSONObject, skip: String? = null): String =
        value.keys().asSequence()
            .filter { it != skip }
            .sorted()
            .joinToString(separator = ",", prefix = "{", postfix = "}") { key ->
                "${quote(key)}:${stable(value.get(key))}"
            }

    private fun stable(value: Any?): String = when (value) {
        null, JSONObject.NULL -> "null"
        is JSONObject -> stableObject(value)
        is JSONArray -> (0 until value.length()).joinToString(
            separator = ",", prefix = "[", postfix = "]",
        ) { stable(value.get(it)) }
        is String -> quote(value)
        is Boolean -> value.toString()
        is Int, is Long, is Short, is Byte -> value.toString()
        is Double -> number(value)
        is Float -> number(value.toDouble())
        // Very large literals come back from the parser as BigInteger/BigDecimal.
        is Number -> value.toString()
        else -> quote(value.toString())
    }

    /**
     * Envelopes carry integral numbers only — v, ts, deltaMs, tookMs, positions —
     * so this collapses the integral doubles the parser may hand back. Do not put
     * a fractional number in an envelope: JavaScript and Kotlin disagree on how to
     * print those, and the disagreement surfaces as a lost signature, not an error.
     */
    private fun number(value: Double): String =
        if (!value.isInfinite() && !value.isNaN() && value == Math.floor(value) &&
            value >= -MAX_SAFE_INTEGER && value <= MAX_SAFE_INTEGER
        ) {
            value.toLong().toString()
        } else {
            value.toString()
        }

    /**
     * JSON string escaping that matches JavaScript's JSON.stringify byte for byte.
     *
     * Deliberately not JSONObject.quote. AOSP's implementation escapes '/' every
     * time it sees one, the Maven org.json that backs the JVM unit tests escapes
     * it only after '<', and JSON.stringify never escapes it at all. An ack whose
     * detail mentions a URL or a package path would therefore canonicalise one way
     * on the device, another way in the test, and a third way in the controller —
     * and the only symptom would be a bare "signature" in the log. Owning the
     * escaper is the only way to hold the two languages to the same output.
     */
    private fun quote(s: String): String {
        val out = StringBuilder(s.length + 2)
        out.append('"')
        var i = 0
        while (i < s.length) {
            val c = s[i]
            when {
                c == '"' -> out.append("\\\"")
                c == '\\' -> out.append("\\\\")
                c == '\b' -> out.append("\\b")
                c == FORM_FEED -> out.append("\\f")
                c == '\n' -> out.append("\\n")
                c == '\r' -> out.append("\\r")
                c == '\t' -> out.append("\\t")
                c < ' ' -> out.append(escapeUnit(c))
                // Well-formed stringify: a matched surrogate pair is emitted as it
                // stands, a lone surrogate is escaped.
                Character.isHighSurrogate(c) -> {
                    val low = if (i + 1 < s.length) s[i + 1] else '\u0000'
                    if (Character.isLowSurrogate(low)) {
                        out.append(c).append(low)
                        i++
                    } else {
                        out.append(escapeUnit(c))
                    }
                }
                Character.isLowSurrogate(c) -> out.append(escapeUnit(c))
                else -> out.append(c)
            }
            i++
        }
        out.append('"')
        return out.toString()
    }

    private fun escapeUnit(c: Char): String = "\\u%04x".format(c.code)

    fun hmacHex(secret: String, message: String): String {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(secret.toByteArray(Charsets.UTF_8), "HmacSHA256"))
        return mac.doFinal(message.toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it) }
    }

    fun sha256Hex(input: String): String =
        java.security.MessageDigest.getInstance("SHA-256")
            .digest(input.toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it) }

    /** Pair code -> HMAC secret. Must match secretFromPairCode in the controller. */
    fun secretFromPairCode(code: String): String = sha256Hex("secret:$code")

    /** Pair code -> relay room id. Must match roomFromPairCode in the controller. */
    fun roomFromPairCode(code: String): String = sha256Hex("room:$code").take(24)

    sealed interface Verdict {
        data class Valid(val envelope: JSONObject) : Verdict
        data class Rejected(val reason: String) : Verdict
    }

    fun verify(raw: String, secret: String, now: Long = System.currentTimeMillis()): Verdict {
        val json = try {
            JSONObject(raw)
        } catch (e: Exception) {
            return Verdict.Rejected("malformed")
        }

        if (json.optInt("v") != PROTOCOL_VERSION) return Verdict.Rejected("version")
        val ts = json.optLong("ts", 0L)
        if (kotlin.math.abs(now - ts) > SKEW_TOLERANCE_MS) return Verdict.Rejected("skew")

        val type = json.optString("type")
        if (type == "hello") return Verdict.Valid(json)

        val provided = json.optString("sig", "")
        val expected = hmacHex(secret, canonicalize(json))
        if (!constantTimeEquals(provided, expected)) return Verdict.Rejected("signature")

        return Verdict.Valid(json)
    }

    private fun constantTimeEquals(a: String, b: String): Boolean {
        if (a.length != b.length) return false
        var diff = 0
        for (i in a.indices) diff = diff or (a[i].code xor b[i].code)
        return diff == 0
    }

    private const val FORM_FEED = '\u000C'
    private const val MAX_SAFE_INTEGER = 9007199254740991.0
}

/** Fixed-size ring of seen ids. What makes mirrored commands safe. */
class DedupeWindow(private val capacity: Int = DEDUPE_WINDOW_SIZE) {
    private val seen = HashSet<String>()
    private val order = ArrayDeque<String>()

    @Synchronized
    fun admit(id: String): Boolean {
        if (!seen.add(id)) return false
        order.addLast(id)
        if (order.size > capacity) seen.remove(order.removeFirst())
        return true
    }
}
