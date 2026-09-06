import type { Transport, TransportEvents } from '@relay/protocol';
import { Buffer } from 'buffer';

/** Must match RelayGattProfile.kt on the receiver. */
export const RELAY_SERVICE_UUID = '0000a17e-0000-1000-8000-00805f9b34fb';
export const RELAY_TX_CHARACTERISTIC = '0000a17f-0000-1000-8000-00805f9b34fb'; // controller → receiver
export const RELAY_RX_CHARACTERISTIC = '0000a180-0000-1000-8000-00805f9b34fb'; // receiver → controller (notify)

/**
 * Path 3 — Bluetooth LE, last-resort fallback.
 *
 * Works with no network at all, which is the entire point: if the router is down
 * and mobile data is off, this is what still reaches the receiver. The cost is
 * a ~180-byte effective MTU after negotiation, so envelopes are chunked with a
 * 3-byte header and reassembled on the far side.
 *
 * Priority 20 — the manager only routes here when both LAN and relay are down.
 */
export class BleTransport implements Transport {
  readonly id = 'ble';
  readonly label = 'Bluetooth';
  readonly priority = 20;
  readonly worksRemotely = false;

  private device: import('react-native-ble-plx').Device | null = null;
  private manager: import('react-native-ble-plx').BleManager | null = null;
  private mtu = 23;
  private readonly inbound = new Map<number, string[]>();
  private seq = 0;

  constructor(private readonly deviceId: string | null) {}

  async connect(events: TransportEvents): Promise<void> {
    if (!this.deviceId) throw new Error('No paired BLE receiver');

    const { BleManager } = await import('react-native-ble-plx');
    this.manager = new BleManager();

    const device = await this.manager.connectToDevice(this.deviceId, {
      requestMTU: 247,
    });
    await device.discoverAllServicesAndCharacteristics();
    this.mtu = device.mtu ?? 23;
    this.device = device;

    device.monitorCharacteristicForService(
      RELAY_SERVICE_UUID,
      RELAY_RX_CHARACTERISTIC,
      (error, characteristic) => {
        if (error) {
          events.onStateChange('failed', error.message);
          return;
        }
        if (!characteristic?.value) return;
        const complete = this.reassemble(
          Buffer.from(characteristic.value, 'base64'),
        );
        if (complete) events.onMessage(complete);
      },
    );

    device.onDisconnected(() => events.onStateChange('failed', 'BLE disconnected'));
    events.onStateChange('connected');
  }

  async send(raw: string): Promise<void> {
    if (!this.device) throw new Error('BLE not connected');

    // 3-byte header: [seq, index, total]. Enough for 255 chunks ≈ 45 KB, far
    // beyond anything this protocol sends.
    const payload = Buffer.from(raw, 'utf8');
    const chunkSize = Math.max(this.mtu - 3 - 3, 17);
    const total = Math.ceil(payload.length / chunkSize);
    if (total > 255) throw new Error('Message too large for BLE');

    const seq = this.seq++ % 256;
    for (let i = 0; i < total; i++) {
      const body = payload.subarray(i * chunkSize, (i + 1) * chunkSize);
      const frame = Buffer.concat([Buffer.from([seq, i, total]), body]);
      await this.device.writeCharacteristicWithResponseForService(
        RELAY_SERVICE_UUID,
        RELAY_TX_CHARACTERISTIC,
        frame.toString('base64'),
      );
    }
  }

  async close(): Promise<void> {
    await this.device?.cancelConnection().catch(() => undefined);
    this.manager?.destroy();
    this.device = null;
    this.manager = null;
  }

  private reassemble(frame: Buffer): string | null {
    if (frame.length < 3) return null;
    const seq = frame[0];
    const index = frame[1];
    const total = frame[2];
    // slice, not subarray: the `buffer` shim types subarray as Uint8Array's,
    // which has a zero-argument toString. slice is declared to return a Buffer.
    const body = frame.slice(3).toString('utf8');

    const parts = this.inbound.get(seq) ?? new Array<string>(total).fill('');
    parts[index] = body;
    this.inbound.set(seq, parts);

    if (parts.every((p) => p !== '')) {
      this.inbound.delete(seq);
      return parts.join('');
    }
    return null;
  }
}
