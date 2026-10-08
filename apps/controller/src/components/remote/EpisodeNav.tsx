import { ChevronDown, ChevronUp, SkipBack, SkipForward } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { haptic } from '../../lib/haptics';
import { palette } from '../../lib/palette';
import { useSession } from '../../state/session';
import { useCommand, useCommandState } from './useCommand';

/** Same grouping the sites use for long series ("1 - 50"), so a list of hundreds stays usable. */
const RANGE = 50;
/** A page needs a moment to load the next episode before a status read sees it. */
const REFRESH_AFTER_MS = 1800;

/**
 * Previous / next episode, and the full list behind a toggle. Shown only while
 * the receiver reports a navigable series (status.nav); hidden otherwise.
 */
export function EpisodeNav() {
  const nav = useSession((s) => s.status?.nav);
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
        disabled={!enabled || busy !== null}
        accessibilityRole="button"
        accessibilityLabel={delta > 0 ? 'Episodio successivo' : 'Episodio precedente'}
        className={`h-14 flex-1 flex-row items-center justify-center gap-2 rounded-2xl border border-border bg-card active:opacity-70 ${enabled ? '' : 'opacity-40'}`}
      >
        {busy === key ? (
          <ActivityIndicator color={palette.foreground} />
        ) : (
          <>
            {delta < 0 ? <Icon size={20} color={palette.foreground} /> : null}
            <Text className="text-base font-semibold text-foreground">{delta > 0 ? 'Successivo' : 'Precedente'}</Text>
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
          {nav.current ? `Episodio ${nav.current}` : 'Episodi'}
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
                    disabled={busy !== null}
                    accessibilityRole="button"
                    accessibilityLabel={`Episodio ${label}`}
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
