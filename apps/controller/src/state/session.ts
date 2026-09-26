import type { DeviceStatus, TopologySnapshot } from '@relay/protocol';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { create } from 'zustand';
import { RelayClient } from '../lib/client';
import { hmacSha256Hex, roomFromPairCode, secretFromPairCode } from '../lib/crypto';
import { buildTransports } from '../lib/transports/registry';
import { type Settings, type Target, useActiveTarget, useSettings } from './settings';

export interface LogLine {
  at: number;
  text: string;
  tone: 'ok' | 'error' | 'info';
}

interface SessionState {
  client: RelayClient | null;
  topology: TopologySnapshot | null;
  status: DeviceStatus | null;
  /** When the last status event arrived; the dashboard greys out stale data. */
  statusAt: number | null;
  log: LogLine[];
  error: string | null;
  pushLog: (text: string, tone?: LogLine['tone']) => void;
}

const MAX_LOG = 80;

/** Live, non-persisted state of the connection to the active target. */
export const useSession = create<SessionState>()((set) => ({
  client: null,
  topology: null,
  status: null,
  statusAt: null,
  log: [],
  error: null,
  pushLog: (text, tone = 'info') =>
    set((s) => ({ log: [{ at: Date.now(), text, tone }, ...s.log].slice(0, MAX_LOG) })),
}));

/**
 * What a rebuild depends on. Changing the seek presets or haptics must not tear
 * down every connection, so the client is keyed on this and nothing else.
 */
function connectionKey(target: Target | null, s: Settings): string {
  if (!target) return '';
  return JSON.stringify([
    target,
    s.transportOrder,
    s.transportEnabled,
    s.relayUrl,
    s.mqttUrl,
    s.stunUrls,
    s.turn,
    s.mirrorCritical,
  ]);
}

/**
 * Owns the RelayClient for the active target. Mounted once, in the root layout.
 *
 * Rebuilding is cheap: TransportManager redials every path in parallel. The
 * status poll pauses when the app is in the background, where it would only
 * burn the receiver's battery for a screen nobody is looking at.
 */
export function useRelayConnection(): void {
  const target = useActiveTarget();
  const hydrated = useSettings((s) => s.hydrated);
  const key = useSettings((s) => connectionKey(target, s));

  useEffect(() => {
    if (!hydrated || !target) return;
    let cancelled = false;
    const settings = useSettings.getState();
    const secret = secretFromPairCode(target.pairCode);
    const room = roomFromPairCode(target.pairCode);
    const hmac = (m: string) => hmacSha256Hex(secret, m);
    const { pushLog } = useSession.getState();

    const client = new RelayClient(
      {
        transports: buildTransports({ target, settings, room, hmac }),
        hmac,
        mirrorCritical: settings.mirrorCritical,
      },
      {
        onTopology: (topology) => !cancelled && useSession.setState({ topology }),
        onStatus: (status) =>
          !cancelled && useSession.setState({ status, statusAt: Date.now() }),
        onLog: (line) => !cancelled && pushLog(line),
      },
    );
    useSession.setState({ client, topology: null, status: null, statusAt: null, error: null });

    client
      .start()
      .then(() => client.refreshStatus())
      .catch((e: Error) => {
        if (cancelled) return;
        useSession.setState({ error: e.message });
        pushLog(e.message, 'error');
      });

    let timer: ReturnType<typeof setInterval> | null = null;
    const poll = () => {
      if (timer) clearInterval(timer);
      timer = setInterval(() => void client.refreshStatus().catch(() => undefined), 4000);
    };
    poll();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        poll();
        void client.refreshStatus().catch(() => undefined);
      } else if (timer) {
        clearInterval(timer);
        timer = null;
      }
    });

    return () => {
      cancelled = true;
      sub.remove();
      if (timer) clearInterval(timer);
      void client.stop();
      if (useSession.getState().client === client) useSession.setState({ client: null });
    };
    // `key` captures every input that matters; target and settings are read fresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, key]);
}
