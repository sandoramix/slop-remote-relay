import { ChevronDown, ChevronUp, SkipBack, SkipForward } from 'lucide-react-native';
import type { NavStatus } from '@relay/protocol';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { haptic } from '../../lib/haptics';
import { useT } from '../../lib/i18n';
import { palette } from '../../lib/palette';
import { useSession } from '../../state/session';
import { useCommand, useCommandState } from './useCommand';

/** Same grouping the sites use for long series ("1 - 50"), so a list of hundreds stays usable. */
const RANGE = 50;
/** A page needs a moment to load the next episode before a status read sees it. */
const REFRESH_AFTER_MS = 1800;

/** While the page loads the next episode, status has no `nav` for a few polls; keep the last one this long. */
const GRACE_MS = 12000;

/**
 * The receiver's nav block, held steady across the gaps a page load leaves:
 * the last good block stays for GRACE_MS after status stops reporting one, and
 * the episode list is carried over from the previous block while the series
 * (same count) is the same, so neither the keys nor the open list flicker.
 */
function useSteadyNav(): { nav: NavStatus | null; live: boolean } {
  const reported = useSession((s) => s.status?.nav);
  const [kept, setKept] = useState<NavStatus | null>(null);

  // No ref writes during render (the React Compiler is on): derive from props/state, store in an effect.
  const carried = reported && !reported.items && kept && kept.count === reported.count ? kept.items : undefined;
  const nav = reported ? (carried ? { ...reported, items: carried } : reported) : kept;

  useEffect(() => {
    if (reported) {
      setKept((prev) =>
        !reported.items && prev && prev.count === reported.count ? { ...reported, items: prev.items } : reported,
      );
      return;
    }
    const timer = setTimeout(() => setKept(null), GRACE_MS);
    return () => clearTimeout(timer);
  }, [reported]);

  return { nav, live: !!reported };
}

/**
 * Previous / next episode, and the full list behind a toggle. Shown only while
 * the receiver reports a navigable series (status.nav); hidden once it has
 * stopped reporting one for longer than a page load takes.
 */
export function EpisodeNav() {
  const t = useT();
  const { nav, live } = useSteadyNav();
  const run = useCommand();
  const busy = useCommandState((s) => s.busy);
  const [open, setOpen] = useState(false);
  const [range, setRange] = useState(0);

  // The list is only requested while it is on screen.
  useEffect(() => {
    const client = useSession.getState().client;
    if (!client) return;
    client.includeNavItems = open;
    if (open) void client.refreshStatus().catch(() => undefined);
    return () => {
      client.includeNavItems = false;
    };
  }, [open]);

  const index = nav?.index ?? null;
  const items = nav?.items;
  // Follow the current episode when it changes (next/prev, or the page's own).
  useEffect(() => {
    if (index !== null) setRange(Math.floor(index / RANGE));
  }, [index]);

  if (!nav) return null;

  const refreshSoon = () =>
    setTimeout(() => void useSession.getState().client?.refreshStatus().catch(() => undefined), REFRESH_AFTER_MS);
  const step = (delta: 1 | -1) => {
    void run(delta > 0 ? 'next' : 'prev', (c) => c.navStep(delta)).then(refreshSoon);
  };

  const ranges = items ? Math.ceil(items.length / RANGE) : 0;
  const visible = items ? items.slice(range * RANGE, range * RANGE + RANGE) : [];

  const stepKey = (delta: 1 | -1, enabled: boolean) => {
    const Icon = delta > 0 ? SkipForward : SkipBack;
    const key = delta > 0 ? 'next' : 'prev';
    return (
      <Pressable
        onPress={() => step(delta)}
        disabled={!live || !enabled || busy !== null}
        accessibilityRole="button"
        accessibilityLabel={delta > 0 ? t('episode.next') : t('episode.prev')}
        className={`h-14 flex-1 flex-row items-center justify-center gap-2 rounded-2xl border border-border bg-card active:opacity-70 ${live && enabled ? '' : 'opacity-40'}`}
      >
        {busy === key ? (
          <ActivityIndicator color={palette.foreground} />
        ) : (
          <>
            {delta < 0 ? <Icon size={20} color={palette.foreground} /> : null}
            <Text className="text-base font-semibold text-foreground">{delta > 0 ? t('episode.nextShort') : t('episode.prevShort')}</Text>
            {delta > 0 ? <Icon size={20} color={palette.foreground} /> : null}
          </>
        )}
      </Pressable>
    );
  };

  return (
    <View className="gap-3">
      <View className="flex-row gap-3">
        {stepKey(-1, nav.hasPrev)}
        {stepKey(1, nav.hasNext)}
      </View>

      <Pressable
        onPress={() => {
          haptic.tap();
          setOpen((o) => !o);
        }}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        className="flex-row items-center justify-between rounded-2xl bg-card px-4 py-3 active:opacity-70"
      >
        <Text className="text-sm font-semibold text-foreground">
          {nav.current ? t('episode.current', { n: nav.current }) : t('episode.list')}
          {nav.count ? ` · ${nav.count}` : ''}
        </Text>
        {open ? <ChevronUp size={18} color={palette.foreground} /> : <ChevronDown size={18} color={palette.foreground} />}
      </Pressable>

      {open ? (
        items ? (
          <View className="gap-3">
            {ranges > 1 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2 pr-2">
                {Array.from({ length: ranges }, (_, r) => {
                  const on = r === range;
                  const to = Math.min((r + 1) * RANGE, items.length);
                  return (
                    <Pressable
                      key={r}
                      onPress={() => setRange(r)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                      className={`rounded-full border px-3 py-1.5 ${on ? 'border-primary bg-primary/15' : 'border-border bg-card'} active:opacity-70`}
                    >
                      <Text className={`text-xs font-semibold ${on ? 'text-primary' : 'text-foreground'}`}>
                        {items[r * RANGE]} – {items[to - 1]}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            ) : null}
            <View className="flex-row flex-wrap gap-2">
              {visible.map((label, i) => {
                const at = range * RANGE + i;
                const on = at === index;
                return (
                  <Pressable
                    key={at}
                    onPress={() => void run('goto', (c) => c.navGoto(at, label)).then(refreshSoon)}
                    disabled={!live || busy !== null}
                    accessibilityRole="button"
                    accessibilityLabel={t('episode.item', { n: label })}
                    accessibilityState={{ selected: on }}
                    className={`min-w-14 items-center rounded-xl border px-3 py-2.5 ${on ? 'border-primary bg-primary' : 'border-border bg-card'} active:opacity-70`}
                  >
                    <Text className={`text-sm font-semibold ${on ? 'text-primary-foreground' : 'text-foreground'}`}>{label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : (
          <ActivityIndicator color={palette.primary} />
        )
      ) : null}
    </View>
  );
}
