/**
 * react-native-zeroconf ships no types and has none on DefinitelyTyped. This is
 * the slice the LAN transport actually uses, not the whole module surface —
 * widen it if a call site needs more.
 */
declare module 'react-native-zeroconf' {
  export interface ZeroconfService {
    name?: string;
    fullName?: string;
    host?: string;
    port?: number;
    addresses?: string[];
    txt?: Record<string, unknown>;
  }

  export type ZeroconfEvent =
    | 'start'
    | 'stop'
    | 'found'
    | 'remove'
    | 'update'
    | 'resolved'
    | 'error';

  export default class Zeroconf {
    /** protocol defaults to 'tcp', domain to 'local.'. */
    scan(type?: string, protocol?: string, domain?: string): void;
    stop(): void;
    removeDeviceListeners(): void;
    addDeviceListeners(): void;
    getServices(): Record<string, ZeroconfService>;
    on(event: 'resolved' | 'found' | 'update' | 'remove', listener: (service: ZeroconfService) => void): void;
    on(event: 'error', listener: (error: Error) => void): void;
    on(event: 'start' | 'stop', listener: () => void): void;
    off(event: ZeroconfEvent, listener?: (...args: unknown[]) => void): void;
  }
}
