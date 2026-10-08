import { useCallback } from 'react';
import { create } from 'zustand';
import type { CommandResult } from '../../lib/client';
import { executorLabel } from '../../lib/format';
import { t } from '../../lib/i18n';
import { haptic } from '../../lib/haptics';
import { useSession } from '../../state/session';
import { TRANSPORTS } from '../../lib/transports/registry';
import type { TransportId } from '@relay/protocol';

export interface Feedback {
  id: number;
  tone: 'ok' | 'error';
  title: string;
  detail?: string;
}

interface CommandState {
  busy: string | null;
  feedback: Feedback | null;
  setBusy: (key: string | null) => void;
  show: (f: Omit<Feedback, 'id'>) => void;
  dismiss: () => void;
}

let counter = 0;

export const useCommandState = create<CommandState>()((set) => ({
  busy: null,
  feedback: null,
  setBusy: (busy) => set({ busy }),
  show: (f) => set({ feedback: { ...f, id: ++counter } }),
  dismiss: () => set({ feedback: null }),
}));

function describe(result: CommandResult): Omit<Feedback, 'id'> {
  const via = result.via ? (TRANSPORTS[result.via as TransportId]?.label ?? result.via) : null;
  const by = result.executedBy ? executorLabel(result.executedBy) : null;
  const meta = [by && t('cmd.via', { by }), via, `${result.rttMs} ms`].filter(Boolean).join(' · ');
  return result.ok
    ? { tone: 'ok', title: result.detail && result.detail.length < 48 ? result.detail : t('cmd.done'), detail: meta }
    : { tone: 'error', title: t('cmd.failed'), detail: result.detail ?? meta };
}

/**
 * Runs one command against the active client with busy state, haptics and the
 * result toast. `key` identifies the button, so only that one shows a spinner.
 * `quiet` skips the toast for repeated sends (hold-to-repeat).
 */
export function useCommand() {
  const setBusy = useCommandState((s) => s.setBusy);
  const show = useCommandState((s) => s.show);

  return useCallback(
    async (
      key: string,
      action: (client: NonNullable<ReturnType<typeof useSession.getState>['client']>) => Promise<CommandResult>,
      options: { quiet?: boolean } = {},
    ) => {
      const client = useSession.getState().client;
      if (!client) {
        haptic.error();
        show({ tone: 'error', title: t('cmd.notConnected'), detail: t('cmd.noPath') });
        return;
      }
      haptic.tap();
      if (!options.quiet) setBusy(key);
      try {
        const result = await action(client);
        if (result.ok) haptic.success();
        else haptic.error();
        if (!options.quiet || !result.ok) show(describe(result));
        useSession.getState().pushLog(
          `${key}: ${result.ok ? 'ok' : 'error'} ${result.detail ?? ''} (${result.rttMs} ms)`,
          result.ok ? 'ok' : 'error',
        );
        void client.refreshStatus().catch(() => undefined);
      } catch (error) {
        haptic.error();
        const message = error instanceof Error ? error.message : String(error);
        show({ tone: 'error', title: t('cmd.error'), detail: message });
        useSession.getState().pushLog(`${key}: ${message}`, 'error');
      } finally {
        if (!options.quiet) setBusy(null);
      }
    },
    [setBusy, show],
  );
}
