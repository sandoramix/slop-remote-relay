import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { TopologySnapshot } from '@relay/protocol';

/**
 * Palette. The use context is a dark room, one hand, glancing away from a
 * screen you are actually watching — so the canvas is a cool slate rather than
 * black (less halation at low brightness), targets are oversized, and exactly
 * one accent carries the primary actions like a backlit remote key.
 */
export const t = {
  canvas: '#1B2027',
  panel: '#232A33',
  panelPressed: '#2C3540',
  hairline: '#313A46',
  ink: '#EDE9E3',
  inkMuted: '#8B95A3',
  accent: '#E8B04B',
  accentInk: '#1B2027',
  live: '#7FA88C',
  down: '#6B7484',
  space: { xs: 4, sm: 8, md: 16, lg: 24, xl: 40 },
  radius: { button: 14, panel: 20 },
};

/**
 * Connection strip. Shows every configured path at once, not just the active
 * one — the whole point of the fallback chain is that you can see it working.
 */
export function ConnectionStrip({ topology }: { topology: TopologySnapshot | null }) {
  if (!topology) {
    return <Text style={s.stripEmpty}>Nessun percorso configurato</Text>;
  }

  return (
    <View style={s.strip}>
      {topology.transports.map((tr) => {
        const live = tr.state === 'connected';
        return (
          <View key={tr.id} style={[s.pill, tr.active && s.pillActive]}>
            <View
              style={[s.dot, { backgroundColor: live ? t.live : t.down }]}
            />
            <Text style={[s.pillLabel, tr.active && s.pillLabelActive]}>
              {tr.label}
            </Text>
            <Text style={s.pillRtt}>
              {tr.rttMs !== null ? `${tr.rttMs} ms` : '—'}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  strip: { flexDirection: 'row', gap: t.space.sm },
  stripEmpty: { color: t.inkMuted, fontSize: 14 },
  pill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.space.xs,
    paddingVertical: t.space.sm,
    paddingHorizontal: t.space.sm,
    borderRadius: t.radius.button,
    backgroundColor: t.panel,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  pillActive: { borderColor: t.accent },
  dot: { width: 7, height: 7, borderRadius: 4 },
  pillLabel: { color: t.inkMuted, fontSize: 12, flexShrink: 1 },
  pillLabelActive: { color: t.ink },
  pillRtt: { color: t.down, fontSize: 11, marginLeft: 'auto' },
});
