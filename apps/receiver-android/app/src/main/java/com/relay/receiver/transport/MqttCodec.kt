package com.relay.receiver.transport

import java.io.ByteArrayOutputStream

/**
 * The slice of MQTT 3.1.1 this project needs: CONNECT, SUBSCRIBE, PUBLISH at
 * QoS 0, PINGREQ and DISCONNECT out; CONNACK, SUBACK, PUBLISH and PINGRESP in.
 * Kotlin twin of packages/transports/src/mqttCodec.ts — keep them in step.
 *
 * QoS 0 is enough because reliability lives a layer up: every command is
 * acked, and duplicates are dropped by id in CommandRouter.
 */
object MqttCodec {

    const val CONNACK = 2
    const val PUBLISH = 3
    const val SUBACK = 9
    const val PINGRESP = 13

    sealed interface Packet {
        data class ConnAck(val returnCode: Int) : Packet
        data class SubAck(val granted: Int) : Packet
        data class Publish(val topic: String, val payload: String) : Packet
        data object PingResp : Packet
        data class Other(val type: Int) : Packet
    }

    private fun remainingLength(n: Int): ByteArray {
        val out = ByteArrayOutputStream()
        var x = n
        do {
            var byte = x % 128
            x /= 128
            if (x > 0) byte = byte or 0x80
            out.write(byte)
        } while (x > 0)
        return out.toByteArray()
    }

    private fun str(s: String): ByteArray {
        val b = s.toByteArray(Charsets.UTF_8)
        return byteArrayOf((b.size shr 8).toByte(), (b.size and 0xff).toByte()) + b
    }

    private fun packet(header: Int, body: ByteArray): ByteArray =
        byteArrayOf(header.toByte()) + remainingLength(body.size) + body

    fun connect(clientId: String, keepAliveSec: Int): ByteArray = packet(
        0x10,
        str("MQTT") +
            byteArrayOf(4, 0x02, (keepAliveSec shr 8).toByte(), (keepAliveSec and 0xff).toByte()) +
            str(clientId),
    )

    fun subscribe(packetId: Int, topic: String): ByteArray = packet(
        0x82,
        byteArrayOf((packetId shr 8).toByte(), (packetId and 0xff).toByte()) + str(topic) + byteArrayOf(0),
    )

    fun publish(topic: String, payload: String): ByteArray =
        packet(0x30, str(topic) + payload.toByteArray(Charsets.UTF_8))

    fun pingreq(): ByteArray = byteArrayOf(0xc0.toByte(), 0)
    fun disconnect(): ByteArray = byteArrayOf(0xe0.toByte(), 0)

    /**
     * Stream parser: MQTT over WebSocket may split a packet across messages or
     * pack several into one.
     */
    class Parser {
        private var buffer = ByteArray(0)

        fun push(chunk: ByteArray): List<Packet> {
            buffer += chunk
            val out = mutableListOf<Packet>()
            while (true) out += next() ?: break
            return out
        }

        private fun next(): Packet? {
            val b = buffer
            if (b.size < 2) return null
            var length = 0
            var multiplier = 1
            var i = 1
            while (true) {
                if (i >= b.size) return null
                val byte = b[i++].toInt() and 0xff
                length += (byte and 0x7f) * multiplier
                if (byte and 0x80 == 0) break
                multiplier *= 128
                require(i <= 4) { "malformed remaining length" }
            }
            if (b.size < i + length) return null

            val header = b[0].toInt() and 0xff
            val body = b.copyOfRange(i, i + length)
            buffer = b.copyOfRange(i + length, b.size)

            return when (val type = header shr 4) {
                CONNACK -> Packet.ConnAck(body.getOrElse(1) { -1 }.toInt() and 0xff)
                SUBACK -> Packet.SubAck(body.getOrElse(2) { 0x80.toByte() }.toInt() and 0xff)
                PINGRESP -> Packet.PingResp
                PUBLISH -> {
                    val qos = (header shr 1) and 3
                    val topicLength = ((body[0].toInt() and 0xff) shl 8) or (body[1].toInt() and 0xff)
                    val topic = String(body, 2, topicLength, Charsets.UTF_8)
                    val start = 2 + topicLength + if (qos > 0) 2 else 0
                    Packet.Publish(topic, String(body, start, body.size - start, Charsets.UTF_8))
                }
                else -> Packet.Other(type)
            }
        }
    }
}
