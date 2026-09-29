package dev.sandoramix.skipper.screen.transport

import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothGattServer
import android.bluetooth.BluetoothGattServerCallback
import android.bluetooth.BluetoothGattService
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.le.AdvertiseCallback
import android.bluetooth.le.AdvertiseData
import android.bluetooth.le.AdvertiseSettings
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.Build
import android.os.ParcelUuid
import android.util.Log
import androidx.core.content.ContextCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * BLE peripheral. The offline fallback: reached when there is no network at
 * all, with the controller a few metres away.
 *
 * The controller writes to TX and subscribes to notifications on RX. Frames
 * larger than the negotiated MTU are chunked with a 3-byte [seq, index, total]
 * header, identical to BleTransport.ts in the controller.
 *
 * Needs BLUETOOTH_ADVERTISE and BLUETOOTH_CONNECT at runtime on Android 12+;
 * without them start() logs and the path simply stays down, which TransportSet
 * tolerates. If Bluetooth is off at start, the path comes up when it is turned
 * on, and goes down again when it is turned off.
 */
class BleGattTransport(
    private val context: Context,
    private val scope: CoroutineScope,
    /** Codec.bleTagFromRoom(room), hex: lets the controller pick us out of a scan. */
    private val tag: String,
) : Transport {

    override val id = "ble"
    override val priority = 20

    private var server: BluetoothGattServer? = null
    private var rx: BluetoothGattCharacteristic? = null
    private val subscribers = ConcurrentHashMap.newKeySet<BluetoothDevice>()
    private val mtu = ConcurrentHashMap<String, Int>()
    private val inbound = ConcurrentHashMap<String, Array<ByteArray?>>()
    private var advertiser: AdvertiseCallback? = null
    private var seq = 0
    /** One notification in flight at a time: the stack drops overlapping ones. */
    private val notifyLock = Mutex()
    @Volatile private var lastNotifyDone = true
    private var onFrame: (suspend (String, String) -> String?)? = null
    private var adapterWatch: BroadcastReceiver? = null

    private fun permitted(): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.S || listOf(
            android.Manifest.permission.BLUETOOTH_ADVERTISE,
            android.Manifest.permission.BLUETOOTH_CONNECT,
        ).all { ContextCompat.checkSelfPermission(context, it) == PackageManager.PERMISSION_GRANTED }

    override fun start(onFrame: suspend (String, String) -> String?) {
        this.onFrame = onFrame
        watchAdapter()
        open()
    }

    /** Follows the Bluetooth switch, so turning it on later needs no restart. */
    private fun watchAdapter() {
        if (adapterWatch != null) return
        val watch = object : BroadcastReceiver() {
            override fun onReceive(ctx: Context, intent: Intent) {
                when (intent.getIntExtra(BluetoothAdapter.EXTRA_STATE, BluetoothAdapter.ERROR)) {
                    BluetoothAdapter.STATE_ON -> if (server == null) open()
                    BluetoothAdapter.STATE_TURNING_OFF, BluetoothAdapter.STATE_OFF -> close()
                }
            }
        }
        ContextCompat.registerReceiver(
            context,
            watch,
            IntentFilter(BluetoothAdapter.ACTION_STATE_CHANGED),
            ContextCompat.RECEIVER_EXPORTED,
        )
        adapterWatch = watch
    }

    @SuppressLint("MissingPermission")
    private fun open() {
        val onFrame = onFrame ?: return
        val manager = context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
        val adapter = manager?.adapter
        if (manager == null || adapter == null || !adapter.isEnabled) {
            Log.w(TAG, "Bluetooth unavailable or off")
            return
        }
        if (!permitted()) {
            Log.w(TAG, "Bluetooth permissions not granted")
            return
        }

        val rxChar = BluetoothGattCharacteristic(
            RX_UUID,
            BluetoothGattCharacteristic.PROPERTY_NOTIFY,
            BluetoothGattCharacteristic.PERMISSION_READ,
        ).apply {
            // The client writes this descriptor to turn notifications on.
            addDescriptor(
                BluetoothGattDescriptor(
                    CCCD_UUID,
                    BluetoothGattDescriptor.PERMISSION_READ or BluetoothGattDescriptor.PERMISSION_WRITE,
                ),
            )
        }
        val service = BluetoothGattService(SERVICE_UUID, BluetoothGattService.SERVICE_TYPE_PRIMARY).apply {
            addCharacteristic(
                BluetoothGattCharacteristic(
                    TX_UUID,
                    BluetoothGattCharacteristic.PROPERTY_WRITE,
                    BluetoothGattCharacteristic.PERMISSION_WRITE,
                ),
            )
            addCharacteristic(rxChar)
        }
        rx = rxChar

        val gatt = manager.openGattServer(context, object : BluetoothGattServerCallback() {
            override fun onConnectionStateChange(device: BluetoothDevice, status: Int, newState: Int) {
                if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                    subscribers.remove(device)
                    mtu.remove(device.address)
                    inbound.remove(device.address)
                } else if (newState == BluetoothProfile.STATE_CONNECTED) {
                    Log.i(TAG, "controller connected over BLE")
                }
            }

            override fun onMtuChanged(device: BluetoothDevice, value: Int) {
                mtu[device.address] = value
            }

            override fun onCharacteristicWriteRequest(
                device: BluetoothDevice,
                requestId: Int,
                characteristic: BluetoothGattCharacteristic,
                preparedWrite: Boolean,
                responseNeeded: Boolean,
                offset: Int,
                value: ByteArray,
            ) {
                if (responseNeeded) {
                    server?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, 0, null)
                }
                if (characteristic.uuid != TX_UUID) return
                val complete = reassemble(device.address, value) ?: return
                scope.launch { onFrame(complete, id)?.let { notify(it, listOf(device)) } }
            }

            override fun onDescriptorWriteRequest(
                device: BluetoothDevice,
                requestId: Int,
                descriptor: BluetoothGattDescriptor,
                preparedWrite: Boolean,
                responseNeeded: Boolean,
                offset: Int,
                value: ByteArray,
            ) {
                if (descriptor.uuid == CCCD_UUID) {
                    if (value.contentEquals(BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE)) subscribers.add(device)
                    else subscribers.remove(device)
                }
                if (responseNeeded) {
                    server?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, 0, null)
                }
            }

            override fun onNotificationSent(device: BluetoothDevice, status: Int) {
                lastNotifyDone = true
            }
        })
        if (gatt == null) {
            Log.w(TAG, "openGattServer returned null")
            return
        }
        gatt.addService(service)
        server = gatt
        advertise(adapter)
    }

    @SuppressLint("MissingPermission")
    private fun advertise(adapter: BluetoothAdapter) {
        val le = adapter.bluetoothLeAdvertiser ?: run {
            Log.w(TAG, "BLE advertising not supported on this device")
            return
        }
        val callback = object : AdvertiseCallback() {
            override fun onStartSuccess(settingsInEffect: AdvertiseSettings) {
                Log.i(TAG, "advertising relay service")
            }
            override fun onStartFailure(errorCode: Int) {
                Log.w(TAG, "advertising failed: $errorCode")
            }
        }
        le.startAdvertising(
            AdvertiseSettings.Builder()
                .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_BALANCED)
                .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_MEDIUM)
                .setConnectable(true)
                .build(),
            AdvertiseData.Builder()
                .addServiceUuid(ParcelUuid(SERVICE_UUID))
                // Our address rotates, so the controller finds us by this tag.
                .addServiceData(ParcelUuid(SERVICE_UUID), tag.chunked(2).map { it.toInt(16).toByte() }.toByteArray())
                .setIncludeDeviceName(false)
                .build(),
            callback,
        )
        advertiser = callback
    }

    private fun reassemble(address: String, frame: ByteArray): String? {
        if (frame.size < HEADER) return null
        val seq = frame[0].toInt() and 0xff
        val index = frame[1].toInt() and 0xff
        val total = frame[2].toInt() and 0xff
        val key = "$address/$seq"
        val parts = inbound.getOrPut(key) { arrayOfNulls(total) }
        if (index >= parts.size) return null
        parts[index] = frame.copyOfRange(HEADER, frame.size)
        if (parts.any { it == null }) return null
        inbound.remove(key)
        return parts.fold(ByteArray(0)) { acc, p -> acc + p!! }.toString(Charsets.UTF_8)
    }

    @SuppressLint("MissingPermission")
    @Suppress("DEPRECATION")
    private suspend fun notify(raw: String, devices: Collection<BluetoothDevice>) {
        val gatt = server ?: return
        val characteristic = rx ?: return
        val payload = raw.toByteArray(Charsets.UTF_8)
        notifyLock.withLock {
            for (device in devices) {
                val chunk = maxOf((mtu[device.address] ?: 23) - 3 - HEADER, 17)
                val total = (payload.size + chunk - 1) / chunk
                if (total > 255) return@withLock
                val s = seq++ and 0xff
                for (i in 0 until total) {
                    val body = payload.copyOfRange(i * chunk, minOf((i + 1) * chunk, payload.size))
                    val frame = byteArrayOf(s.toByte(), i.toByte(), total.toByte()) + body
                    lastNotifyDone = false
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                        gatt.notifyCharacteristicChanged(device, characteristic, false, frame)
                    } else {
                        characteristic.value = frame
                        gatt.notifyCharacteristicChanged(device, characteristic, false)
                    }
                    // Wait for onNotificationSent, bounded so a lost callback
                    // cannot wedge the path.
                    var waited = 0
                    while (!lastNotifyDone && waited < 200) {
                        delay(5)
                        waited += 5
                    }
                }
            }
        }
    }

    override fun send(raw: String) {
        val targets = subscribers.toList()
        if (targets.isEmpty()) return
        scope.launch { notify(raw, targets) }
    }

    override fun isUp(): Boolean = subscribers.isNotEmpty()

    override fun stop() {
        adapterWatch?.let { runCatching { context.unregisterReceiver(it) } }
        adapterWatch = null
        onFrame = null
        close()
    }

    @SuppressLint("MissingPermission")
    private fun close() {
        runCatching {
            val manager = context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
            advertiser?.let { manager?.adapter?.bluetoothLeAdvertiser?.stopAdvertising(it) }
        }
        advertiser = null
        runCatching { server?.close() }
        server = null
        subscribers.clear()
        mtu.clear()
        inbound.clear()
    }

    companion object {
        /** Must match ble.ts in the controller. */
        val SERVICE_UUID: UUID = UUID.fromString("0000a17e-0000-1000-8000-00805f9b34fb")
        val TX_UUID: UUID = UUID.fromString("0000a17f-0000-1000-8000-00805f9b34fb")
        val RX_UUID: UUID = UUID.fromString("0000a180-0000-1000-8000-00805f9b34fb")
        private val CCCD_UUID: UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")
        private const val HEADER = 3
        private const val TAG = "BleGattTransport"
    }
}
