package com.relay.receiver.core

import android.util.Base64
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

    fun canonicalize(json: JSONObject): String {
        val copy = JSONObject(json.toString())
        copy.remove("sig")
        return stable(copy)
    }

    private fun stable(value: Any?): String = when (value) {
        null, JSONObject.NULL -> "null"
        is JSONObject -> value.keys().asSequence().sorted().joinToString(
            separator = ",", prefix = "{", postfix = "}",
        ) { key -> "${quote(key)}:${stable(value.get(key))}" }
        is JSONArray -> (0 until value.length()).joinToString(
            separator = ",", prefix = "[", postfix = "]",
        ) { stable(value.get(it)) }
        is String -> quote(value)
        is Boolean -> value.toString()
        is Int, is Long -> value.toString()
        is Double -> if (value == Math.floor(value) && !value.isInfinite())
            value.toLong().toString() else value.toString()
        else -> quote(value.toString())
    }

    private fun quote(s: String): String = JSONObject.quote(s)

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
