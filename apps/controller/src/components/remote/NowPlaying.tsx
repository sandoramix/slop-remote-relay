import { Pause, Play } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { Slider, SliderFilledTrack, SliderThumb, SliderTrack } from '@/components/ui/slider';
import { clock, prettySource } from '../../lib/format';
import { palette } from '../../lib/palette';
import { useSession } from '../../state/session';
import { useCommand, useCommandState } from './useCommand';

/** Status older than this is shown as stale rather than trusted. */
const STALE_MS = 12_000;

/**
 * What the receiver is playing, with a scrub bar.
 *
 * Position comes from the last status event and is extrapolated between
 * events while playing, so the bar moves smoothly on a 4-second poll. Dragging
 * freezes it at the finger; releasing sends one absolute seek.
 */
export function NowPlaying() {
  const status = useSession((s) => s.status);
  const statusAt = useSession((s) => s.statusAt);
  const busy = useCommandState((s) => s.busy);
  const run = useCommand();
  const [now, setNow] = useState(Date.now());
  const [dragMs, setDragMs] = useState<number | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const stale = !statusAt || now - statusAt > STALE_MS;
  const source = prettySource(status?.foregroundPackage);
  const duration = status?.durationMs ?? null;
  let position = status?.positionMs ?? null;
  if (position != null && status?.isPlaying && statusAt) position += now - statusAt;
  if (position != null && duration) position = Math.min(position, duration);
  const shown = dragMs ?? position;
  const canScrub = !!duration && position != null && status?.hasMediaSession;

  return (
    <View className="gap-4 rounded-3xl border border-border bg-card p-5">
      <View className="flex-row items-start gap-4">
        <View className="flex-1 gap-1">
          <Text className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            {source ?? (status ? 'Nessuna app in primo piano' : 'In attesa del dispositivo')}
            {stale && status ? ' · non aggiornato' : ''}
          </Text>
          <Text className="text-lg font-semibold leading-6 text-foreground" numberOfLines={2}>
            {status?.title || (status?.hasMediaSession ? 'In riproduzione' : 'Nessun contenuto multimediale rilevato')}
          </Text>
        </View>
        <Pressable
          onPress={() => void run('pp', (c) => c.playPause())}
          disabled={busy !== null}
          accessibilityRole="button"
          accessibilityLabel={status?.isPlaying ? 'Pausa' : 'Riproduci'}
          className="h-14 w-14 items-center justify-center rounded-full bg-primary active:opacity-80"
        >
          {busy === 'pp' ? (
            <ActivityIndicator color={palette.primaryInk} />
          ) : status?.isPlaying ? (
            <Pause size={26} color={palette.primaryInk} fill={palette.primaryInk} />
          ) : (
            <Play size={26} color={palette.primaryInk} fill={palette.primaryInk} style={{ marginLeft: 3 }} />
          )}
        </Pressable>
      </View>

      {canScrub ? (
        <View className="gap-1">
          <Slider
            value={shown ?? 0}
            minValue={0}
            maxValue={duration!}
            step={1000}
            onChange={(v: number) => setDragMs(v)}
            onChangeEnd={(v: number) => {
              setDragMs(null);
              void run('scrub', (c) => c.seekTo(v));
            }}
            accessibilityLabel="Posizione"
            className="h-8"
          >
            <SliderTrack className="h-1.5 rounded-full bg-secondary">
              <SliderFilledTrack className="rounded-full bg-primary" />
            </SliderTrack>
            <SliderThumb className="h-5 w-5 rounded-full bg-foreground" />
          </Slider>
          <View className="flex-row justify-between">
            <Text className="text-xs text-muted-foreground" style={{ fontVariant: ['tabular-nums'] }}>
              {clock((shown ?? 0) / 1000)}
            </Text>
            <Text className="text-xs text-muted-foreground" style={{ fontVariant: ['tabular-nums'] }}>
              −{clock((duration! - (shown ?? 0)) / 1000)}
            </Text>
          </View>
        </View>
      ) : status && !status.hasMediaSession ? (
        <Text className="text-xs leading-5 text-muted-foreground">
          Il salto userà i tocchi sullo schermo (a passi di 10 s). Per salti esatti concedi al
          ricevitore l'accesso alle notifiche.
        </Text>
      ) : null}
    </View>
  );
}
