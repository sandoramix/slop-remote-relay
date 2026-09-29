import AsyncStorage from '@react-native-async-storage/async-storage';
import { DEFAULT_MQTT_URL, DEFAULT_STUN_URLS, TRANSPORT_IDS, type TransportId } from '@relay/protocol';
import { z } from 'zod';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/**
 * Persisted controller settings.
 *
 * The schema is the source of truth: what comes back from storage is parsed
 * with it, and anything that fails — a field from a newer build, a hand-edited
 * value, a half-written blob — falls back to the default for that field rather
 * than taking the app down on launch.
 */

export const TargetSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(40),
  kind: z.enum(['android', 'browser']),
  pairCode: z.string().min(1),
  /** LAN address of an Android receiver; discovered over mDNS or typed. */
  lanHost: z.string().nullable().default(null),
});
export type Target = z.infer<typeof TargetSchema>;

const TransportIdSchema = z.enum(TRANSPORT_IDS);

const TurnSchema = z.object({
  urls: z.string().min(1),
  username: z.string(),
  credential: z.string(),
});

export const SettingsSchema = z.object({
  targets: z.array(TargetSchema).catch([]),
  activeTargetId: z.string().nullable().catch(null),

  /**
   * The user's failover order, best first. Always a permutation of every known
   * transport — a transport added in a later build is appended by `normalizeOrder`
   * so it shows up in the list instead of silently never running.
   */
  transportOrder: z.array(TransportIdSchema).catch([...TRANSPORT_IDS]),
  transportEnabled: z.record(TransportIdSchema, z.boolean()).catch({} as Record<TransportId, boolean>),

  relayUrl: z.string().nullable().catch(null),
  mqttUrl: z.string().catch(DEFAULT_MQTT_URL),
  stunUrls: z.array(z.string()).catch([...DEFAULT_STUN_URLS]),
  turn: TurnSchema.nullable().catch(null),

  /** Seconds. Any number of them, any size: each becomes a chip on the remote. */
  seekPresets: z.array(z.number().int().positive().max(86_400)).min(1).catch([10, 30, 60, 300]),
  /** The chip selected on the remote, so it survives a restart. */
  selectedSeek: z.number().int().positive().max(86_400).catch(30),

  /** Mirror commands across two transports. Costs a duplicate frame, buys reliability. */
  mirrorCritical: z.boolean().catch(true),
  haptics: z.boolean().catch(true),
  keepAwake: z.boolean().catch(false),
});
export type Settings = z.infer<typeof SettingsSchema>;

export const DEFAULT_SETTINGS: Settings = SettingsSchema.parse({});

/** Every known transport exactly once, the user's order first. */
export function normalizeOrder(order: readonly TransportId[]): TransportId[] {
  const seen = new Set<TransportId>();
  const out: TransportId[] = [];
  for (const id of [...order, ...TRANSPORT_IDS]) {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

export const isEnabled = (s: Pick<Settings, 'transportEnabled'>, id: TransportId): boolean =>
  s.transportEnabled[id] ?? true;

interface Actions {
  set: (patch: Partial<Settings>) => void;
  upsertTarget: (target: Target) => void;
  removeTarget: (id: string) => void;
  setActiveTarget: (id: string) => void;
  moveTransport: (id: TransportId, delta: -1 | 1) => void;
  toggleTransport: (id: TransportId, enabled: boolean) => void;
  reset: () => void;
}

export type SettingsStore = Settings & Actions & { hydrated: boolean };

const STORAGE_KEY = 'relay.settings.v2';

export const useSettings = create<SettingsStore>()(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS,
      hydrated: false,

      set: (patch) => set(patch),

      upsertTarget: (target) =>
        set((s) => {
          const exists = s.targets.some((t) => t.id === target.id);
          const targets = exists
            ? s.targets.map((t) => (t.id === target.id ? target : t))
            : [...s.targets, target];
          return { targets, activeTargetId: s.activeTargetId ?? target.id };
        }),

      removeTarget: (id) =>
        set((s) => {
          const targets = s.targets.filter((t) => t.id !== id);
          const activeTargetId =
            s.activeTargetId === id ? (targets[0]?.id ?? null) : s.activeTargetId;
          return { targets, activeTargetId };
        }),

      setActiveTarget: (id) => set({ activeTargetId: id }),

      moveTransport: (id, delta) =>
        set((s) => {
          const order = normalizeOrder(s.transportOrder);
          const from = order.indexOf(id);
          const to = from + delta;
          if (from < 0 || to < 0 || to >= order.length) return {};
          [order[from], order[to]] = [order[to]!, order[from]!];
          return { transportOrder: order };
        }),

      toggleTransport: (id, enabled) =>
        set((s) => ({ transportEnabled: { ...s.transportEnabled, [id]: enabled } })),

      reset: () => set({ ...DEFAULT_SETTINGS }),
    }),
    {
      name: STORAGE_KEY,
      version: 2,
      storage: createJSONStorage(() => AsyncStorage),
      // Only data is persisted; actions and the hydration flag are rebuilt.
      partialize: (s) => SettingsSchema.parse(s),
      merge: (persisted, current) => {
        const parsed = SettingsSchema.safeParse(persisted ?? {});
        const data = parsed.success ? parsed.data : DEFAULT_SETTINGS;
        return {
          ...current,
          ...data,
          transportOrder: normalizeOrder(data.transportOrder),
        };
      },
      onRehydrateStorage: () => () => {
        useSettings.setState({ hydrated: true });
      },
    },
  ),
);

/** The target the remote currently drives. */
export const useActiveTarget = (): Target | null =>
  useSettings((s) => s.targets.find((t) => t.id === s.activeTargetId) ?? s.targets[0] ?? null);
