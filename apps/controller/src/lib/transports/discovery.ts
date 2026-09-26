import { MDNS_SERVICE_TYPE } from '@relay/protocol';

export interface DiscoveredReceiver {
  name: string;
  host: string;
  port: number;
}

/**
 * mDNS/NSD discovery of Android receivers on the current network. Wraps
 * react-native-zeroconf so nothing else imports the native module: swap the
 * library and only this file changes.
 */
export async function discoverReceivers(timeoutMs = 4000): Promise<DiscoveredReceiver[]> {
  const { default: Zeroconf } = await import('react-native-zeroconf');
  const zeroconf = new Zeroconf();
  const found = new Map<string, DiscoveredReceiver>();
  // '_relayctl._tcp' → 'relayctl', 'tcp'
  const [service, protocol] = MDNS_SERVICE_TYPE.replace(/^_/, '').split('._');

  return new Promise((resolve) => {
    const finish = () => {
      zeroconf.stop();
      zeroconf.removeDeviceListeners?.();
      resolve([...found.values()]);
    };
    const timer = setTimeout(finish, timeoutMs);

    zeroconf.on('resolved', (s: { name?: string; addresses?: string[]; port?: number }) => {
      const host = s.addresses?.find((a) => !a.includes(':'));
      if (host) found.set(host, { name: s.name ?? host, host, port: s.port ?? 0 });
    });
    zeroconf.on('error', () => {
      clearTimeout(timer);
      finish();
    });
    zeroconf.scan(service!, protocol!, 'local.');
  });
}
