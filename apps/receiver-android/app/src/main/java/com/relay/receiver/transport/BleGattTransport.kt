package com.relay.receiver.transport

import android.annotation.SuppressLint
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattServer
import android.bluetooth.BluetoothGattService
import android.bluetooth.BluetoothManager
import android.content.Context
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import java.util.UUID

/**
 * Path 3 — BLE peripheral. The offline fallback.
 *
 * Reached only when both LAN and relay are down: router unplugged, no mobile
 * data, or the receiver moved to a network the controller cannot see. Throughput
 * is irrelevant here (a command is ~200 bytes) but the MTU is not, so frames are
 * chunked with a 3-byte [seq, index, total] header matching BleTransport.ts.
 *
 * Left as a scaffold on purpose: get LAN and relay green first, then fill this
 * in. TransportSet already tolerates a transport that never comes up.
 */
class BleGattTransport(
    private val context: Context,
    private val scope: CoroutineScope,
) : Transport {

    override val id = "ble"
    override val priority = 20

    private var server: BluetoothGattServer? = null
    private var up = false
    private val inbound = HashMap<Int, Array<String?>>()

    @SuppressLint("MissingPermission")
    override fun start(onFrame: suspend (String, String) -> String?) {
        val manager = context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
        if (manager == null) {
            Log.w(TAG, "No Bluetooth service on this device")
            return
        }

        // TODO(step 3): open the GATT server, register SERVICE_UUID with a
        // write characteristic (TX) and a notify characteristic (RX), start
        // advertising, then reassemble chunks and feed them to onFrame.
        //
        // The reassembly logic is the mirror image of BleTransport.reassemble in
        // the controller; keep the header format identical.

        val service = BluetoothGattService(SERVICE_UUID, BluetoothGattService.SERVICE_TYPE_PRIMARY)
        service.addCharacteristic(
            BluetoothGattCharacteristic(
                TX_UUID,
                BluetoothGattCharacteristic.PROPERTY_WRITE,
                BluetoothGattCharacteristic.PERMISSION_WRITE,
            ),
        )
        service.addCharacteristic(
            BluetoothGattCharacteristic(
                RX_UUID,
                BluetoothGattCharacteristic.PROPERTY_NOTIFY,
                BluetoothGattCharacteristic.PERMISSION_READ,
            ),
        )
        Log.i(TAG, "BLE scaffold ready (not advertising yet)")
    }

    override fun send(raw: String) { /* TODO: chunk and notify */ }
    override fun isUp(): Boolean = up
    @SuppressLint("MissingPermission")
    override fun stop() { server?.close(); server = null; up = false }

    companion object {
        val SERVICE_UUID: UUID = UUID.fromString("0000a17e-0000-1000-8000-00805f9b34fb")
        val TX_UUID: UUID = UUID.fromString("0000a17f-0000-1000-8000-00805f9b34fb")
        val RX_UUID: UUID = UUID.fromString("0000a180-0000-1000-8000-00805f9b34fb")
        private const val TAG = "BleGattTransport"
    }
}
