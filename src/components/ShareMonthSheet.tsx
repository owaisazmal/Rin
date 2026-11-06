import { useMemo, useRef, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import LogoMark from './LogoMark';
import RadialTracker from './RadialTracker';
import { Sheet, SheetActions } from './Sheet';
import { MONTH_NAMES } from '../dates';
import { SHARE_IMAGE, shareViewAsImage } from '../shareImage';
import { FONT, Palette, RADIUS, useTheme, wrapSafe } from '../theme';
import type { CellState, Habit } from '../types';

/** The month as a picture: the ring, the count, and where the app lives. No habit names, no notes. */

const SITE = 'owaisazmal.github.io/Rin';
const noop = () => {};
const never = () => false;

interface Props {
  visible: boolean;
  onClose: () => void;
  year: number;
  month: number;
  daysInMonth: number;
  habits: Habit[];
  grid: Record<string, CellState>;
  today: number | null;
  stats: { done: number; total: number; pct: number };
}

export default function ShareMonthSheet({
  visible,
  onClose,
  year,
  month,
  daysInMonth,
  habits,
  grid,
  today,
  stats,
}: Props) {
  const { palette } = useTheme();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const cardRef = useRef<View>(null);
  // the preview is the capture itself, drawn at whatever width the sheet gives and scaled up on the way out
  const [width, setWidth] = useState(0);
  const [busy, setBusy] = useState(false);

  const u = width / 360;
  const height = (width * SHARE_IMAGE.height) / SHARE_IMAGE.width;
  const ring = Math.round(width * 0.72);
  const habitLine = `${habits.length} habit${habits.length === 1 ? '' : 's'}`;

  const share = async () => {
    if (busy || !width) return;
    setBusy(true);
    try {
      await shareViewAsImage(cardRef, `rin-${year}-${String(month + 1).padStart(2, '0')}`);
      onClose();
    } catch {
      Alert.alert('Could not make the picture', 'Try again in a moment.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose}>
      <Text style={styles.title} accessibilityRole="header">
        Share this month
      </Text>
      <Text style={styles.caption}>
        The ring and the count, as a picture. Habit names, notes and goals stay out of it.
      </Text>

      <View style={styles.preview} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        {width > 0 ? (
          <View
            ref={cardRef}
            collapsable={false}
            pointerEvents="none"
            style={[styles.card, { width, height, padding: 20 * u }]}
          >
            <View style={styles.row}>
              <View style={styles.brand}>
                <LogoMark size={24 * u} />
                <Text style={[styles.brandText, { fontSize: 13 * u, letterSpacing: 3 * u }]}>RIN</Text>
              </View>
              <Text style={[styles.month, { fontSize: 13 * u, letterSpacing: 2 * u }]}>
                {MONTH_NAMES[month]} {year}
              </Text>
            </View>

            <RadialTracker
              size={ring}
              daysInMonth={daysInMonth}
              habits={habits}
              grid={grid}
              today={today}
              canMark={never}
              selectedDay={0}
              onToggle={noop}
              onSelectDay={noop}
            />

            <View style={styles.foot}>
              <Text style={[styles.stats, { fontSize: 14 * u }]}>
                <Text style={styles.statsDone}>{stats.done}</Text>
                {` / ${stats.total} · ${stats.pct}% · ${habitLine}`}
              </Text>
              <Text style={[styles.site, { fontSize: 11 * u, letterSpacing: 1 * u }]}>
                Free and open source · {SITE}
              </Text>
            </View>
          </View>
        ) : null}
      </View>

      <SheetActions
        onCancel={onClose}
        confirmLabel={busy ? 'SHARING…' : 'SHARE'}
        onConfirm={share}
        disabled={busy || width === 0}
      />
    </Sheet>
  );
}

const makeStyles = (p: Palette) =>
  StyleSheet.create({
    title: {
      fontFamily: FONT.bold,
      fontSize: wrapSafe(16),
      color: p.ink,
      marginBottom: 6,
    },
    caption: {
      fontFamily: FONT.regular,
      fontSize: wrapSafe(12),
      lineHeight: wrapSafe(17),
      color: p.inkSoft,
      marginBottom: 14,
    },
    /** rounded for the page; the capture inside keeps square corners so the PNG has no clear edge */
    preview: {
      alignSelf: 'stretch',
      borderRadius: RADIUS.card,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: p.lineFaint,
    },
    card: {
      backgroundColor: p.bg,
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    row: {
      alignSelf: 'stretch',
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    brand: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    brandText: { fontFamily: FONT.bold, color: p.ink },
    month: { fontFamily: FONT.bold, color: p.ink },
    foot: { alignItems: 'center', gap: 6 },
    stats: { fontFamily: FONT.regular, color: p.inkSoft },
    statsDone: { fontFamily: FONT.bold, color: p.done },
    site: { fontFamily: FONT.medium, color: p.inkSoft },
  });
