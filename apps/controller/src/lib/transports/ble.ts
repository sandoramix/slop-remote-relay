import type { Transport, TransportEvents } from '@relay/protocol';
import { utf8Decode, utf8Encode } from '@relay/transports';
import { PermissionsAndroid, Platform } from 'react-native';
import type { BleManager, Device } from 'react-native-ble-plx';

/** Must match BleGattTransport.kt on the receiver. */
export const RELAY_SERVICE_UUID = '0000a17e-0000-1000-8000-00805f9b34fb';
/** controller → receiver, write with response */
export const RELAY_TX_CHARACTERISTIC = '0000a17f-0000-1000-8000-00805f9b34fb';
/** receiver → controller, notify */
export const RELAY_RX_CHARACTERISTIC = '0000a180-0000-1000-8000-00805f9b34fb';

/** Frames carry a 3-byte header: [seq, index, total]. Same on both sides. */
const HEADER = 3;

let shared: BleManager | null = null;

async function manager(): Promise<BleManager> {
  if (!shared) {
    const { BleManager } = await import('react-native-ble-plx');
    shared = new BleManager();
  }
  return shared;
}

/** Android 12+ asks for the two runtime Bluetooth permissions separately. */
export async function ensureBlePermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  if (Platform.Version >= 31) {
    const res = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN!,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT!,
    ]);
    return Object.values(res).every((r) => r === PermissionsAndroid.RESULTS.GRANTED);
  }
  const res = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION!,
  );
  return res === PermissionsAndroid.RESULTS.GRANTED;
}

export interface ScannedReceiver {
  id: string;
  name: string;
  rssi: number | null;
}

/** Finds receivers advertising the relay service, for the device editor. */
export async function scanReceivers(timeoutMs = 6000): Promise<ScannedReceiver[]> {
  if (!(await ensureBlePermissions())) throw new Error('Permessi Bluetooth negati');
  const ble = await manager();
  const found = new Map<string, ScannedReceiver>();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ble.stopDeviceScan();
      resolve([...found.values()]);
    }, timeoutMs);
    ble.startDeviceScan([RELAY_SERVICE_UUID], null, (error, device) => {
      if (error) {
        clearTimeout(timer);
        ble.stopDeviceScan();
        reject(error);
        return;
      }
      if (device) {
        found.set(device.id, {
          id: device.id,
          name: device.localName ?? device.name ?? device.id,
          rssi: device.rssi,
        });
      }
    });
  });
}

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Bluetooth LE. Works with no network at all, which is the entire point: if
 * the router is down and mobile data is off, this still reaches the receiver.
 * The cost is a small MTU, so envelopes are chunked and reassembled.
 */
export class BleTransport implements Transport {
  readonly id = 'ble';
  readonly label = 'Bluetooth';
  readonly priority: number;
  readonly worksRemotely = false;

  private device: Device | null = null;
  private mtu = 23;
  private readonly inbound = new Map<number, Uint8Array[]>();
  private seq = 0;

  constructor(
    private readonly deviceId: string,
    priority?: number,
  ) {
    this.priority = priority ?? 20;
  }

  async connect(events: TransportEvents): Promise<void> {
    if (!(await ensureBlePermissions())) throw new Error('Permessi Bluetooth negati');
    const ble = await manager();
    const device = await ble.connectToDevice(this.deviceId, { requestMTU: 247, timeout: 8000 });
    await device.discoverAllServicesAndCharacteristics();
    this.mtu = device.mtu ?? 23;
    this.device = device;

    device.monitorCharacteristicForService(
      RELAY_SERVICE_UUID,
      RELAY_RX_CHARACTERISTIC,
      (error, characteristic) => {
        if (error) {
          if (this.device === device) events.onStateChange('failed', error.message);
          return;
        }
        if (!characteristic?.value) return;
        const complete = this.reassemble(fromBase64(characteristic.value));
        if (complete) events.onMessage(complete);
      },
    );
    device.onDisconnected(() => {
      if (this.device === device) events.onStateChange('failed', 'BLE disconnected');
    });
    events.onStateChange('connected');
  }

  async send(raw: string): Promise<void> {
    const device = this.device;
    if (!device) throw new Error('BLE not connected');

    const payload = utf8Encode(raw);
    // ATT write payload is MTU - 3; our own header takes 3 more.
    const chunk = Math.max(this.mtu - 3 - HEADER, 17);
    const total = Math.ceil(payload.length / chunk);
    if (total > 255) throw new Error('Message too large for BLE');

    const seq = this.seq++ % 256;
    for (let i = 0; i < total; i++) {
      const body = payload.subarray(i * chunk, (i + 1) * chunk);
      const frame = new Uint8Array(HEADER + body.length);
      frame.set([seq, i, total]);
      frame.set(body, HEADER);
      await device.writeCharacteristicWithResponseForService(
        RELAY_SERVICE_UUID,
        RELAY_TX_CHARACTERISTIC,
        toBase64(frame),
      );
    }
  }

  async close(): Promise<void> {
    const device = this.device;
    this.device = null;
    await device?.cancelConnection().catch(() => undefined);
  }

  private reassemble(frame: Uint8Array): string | null {
    if (frame.length < HEADER) return null;
    const [seq, index, total] = [frame[0]!, frame[1]!, frame[2]!];
    const parts = this.inbound.get(seq) ?? new Array<Uint8Array>(total);
    parts[index] = frame.subarray(HEADER);
    this.inbound.set(seq, parts);

    for (let i = 0; i < total; i++) if (!parts[i]) return null;
    this.inbound.delete(seq);
    const size = parts.reduce((n, p) => n + p.length, 0);
    const joined = new Uint8Array(size);
    let offset = 0;
    for (const p of parts) {
      joined.set(p, offset);
      offset += p.length;
    }
    return utf8Decode(joined);
  }
}
