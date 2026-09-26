package com.relay.receiver

import com.relay.receiver.transport.MqttCodec
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The Kotlin MQTT codec against bytes produced by packages/transports/src/mqttCodec.ts.
 * If one side changes its framing, a broker will still accept both — and the
 * two ends will silently stop hearing each other. These pin it.
 */
class MqttCodecTest {

    private fun ByteArray.hex() = joinToString("") { "%02x".format(it) }

    @Test
    fun `publish matches the TypeScript encoder`() {
        assertEquals(
            "3024001372656c617963746c2f722f72656365697665727b2261223a22c3a820f09f8eac227d",
            MqttCodec.publish("relayctl/r/receiver", "{\"a\":\"è 🎬\"}").hex(),
        )
    }

    @Test
    fun `connect and subscribe match the TypeScript encoder`() {
        assertEquals("101300044d5154540402001e000772656c61792d78", MqttCodec.connect("relay-x", 30).hex())
        assertEquals(
            "82180001001372656c617963746c2f722f726563656976657200",
            MqttCodec.subscribe(1, "relayctl/r/receiver").hex(),
        )
    }

    @Test
    fun `parser reassembles a split publish and reads two packets from one chunk`() {
        val bytes = MqttCodec.publish("t/x", "y".repeat(300))
        val parser = MqttCodec.Parser()
        assertEquals(emptyList<MqttCodec.Packet>(), parser.push(bytes.copyOfRange(0, 3)))
        val out = parser.push(bytes.copyOfRange(3, bytes.size) + byteArrayOf(0xd0.toByte(), 0))
        assertEquals(MqttCodec.Packet.Publish("t/x", "y".repeat(300)), out[0])
        assertEquals(MqttCodec.Packet.PingResp, out[1])
    }
}
