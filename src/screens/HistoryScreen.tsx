import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import SectionHeader from '../components/SectionHeader';
import SegmentedControl from '../components/SegmentedControl';
import Spinner, { LoadingBlock } from '../components/Spinner';
import { Task } from '../tasks';
import {
  HistoryDay,
  HistoryFilter,
  dayHeading,
  filterHistory,
  historyTotals,
  lateness,
} from '../history';
import { useHistory } from '../hooks/useHistory';
import { useNow } from '../hooks/useNow';
import { startOfDay } from '../dates';
import { FONT, Palette, RADIUS, cardSurface, useTheme } from '../theme';

/**
 * What has already happened — habits ticked or missed, deadlines finished —
 * newest first.
 *
 * A record rather than a chart: the tracker already answers "how much", so this
 * answers "what, and when". Nothing here is editable, which is the point; the
 * planner is where a day is changed, and this is where it is read back.
 */

const FILTERS = [
  { value: 'all' as HistoryFilter, label: 'ALL' },
  { value: 'habits' as HistoryFilter, label: 'HABITS' },
  { value: 'deadlines' as HistoryFilter, label: 'DEADLINES' },
] as const;

interface Props {
  tasks: Task[];
  /** false while the screen is closed, so it doesn't read storage in the background */
  active: boolean;
  /** which tab to open on — the header opens on everything, the deadlines
   *  section opens on deadlines */
  initialFilter: HistoryFilter;
  onClose: () => void;
}

export default function HistoryScreen({ tasks, active, initialFilter, onClose }: Props) {
  const { palette } = useTheme();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const [filter, setFilter] = useState<HistoryFilter>(initialFilter);

  // Adopt the requested tab on the way in, and not after: switching tabs while
  // the screen is open is the reader's decision, not the caller's.
  useEffect(() => {
    if (active) setFilter(initialFilter);
  }, [active, initialFilter]);

  // A minute is plenty: the only thing that moves here is "TODAY" rolling over.
  const now = useNow(60_000);

  /**
   * The same instant, rounded down to the day.
   *
   * Rows only need `now` to decide whether a date is today or yesterday, and
   * handing them the raw clock would change their props every minute and defeat
   * the memo on every visible card. Rounded, the value is stable until midnight.
   */
  const todayStart = useMemo(() => startOfDay(now), [now]);
  const { days, loading, loadingMore, loadMore, canLoadMore } = useHistory(tasks, active, now);

  const shown = useMemo(() => filterHistory(days, filter), [days, filter]);
  const totals = useMemo(() => historyTotals(shown), [shown]);

  const renderDay = useCallback(
    ({ item }: { item: HistoryDay }) => (
      <DayCard day={item} today={todayStart} palette={palette} styles={styles} />
    ),
    [todayStart, palette, styles]
  );

  // Rebuilt on render but never remounted: same element type each time, so the
  // segmented control keeps its slide position rather than snapping back.
  const header = (
    <>
      <View style={styles.header}>
        <Text style={styles.title}>HISTORY</Text>
        <Pressable
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Close history"
          onPress={onClose}
          style={({ pressed }) => [styles.closeBtn, pressed && { opacity: 0.6 }]}
        >
          <Text style={styles.closeGlyph}>✕</Text>
        </Pressable>
      </View>

      <SegmentedControl
        options={FILTERS}
        value={filter}
        onChange={setFilter}
        verticalPadding={8}
        style={styles.filter}
      />

      {shown.length > 0 && (
        <View style={styles.summary}>
          <Summary value={totals.done} label="done" tone={palette.done} styles={styles} />
          <Summary value={totals.missed} label="missed" tone={palette.missed} styles={styles} />
          <Summary
            value={totals.finished}
            label={totals.finished === 1 ? 'deadline' : 'deadlines'}
            tone={palette.accent}
            styles={styles}
          />
          <Summary
            value={totals.days}
            label={totals.days === 1 ? 'day' : 'days'}
            tone={palette.inkSoft}
            styles={styles}
          />
        </View>
      )}
    </>
  );

  const empty = loading ? (
    <LoadingBlock label="Reading the last few months…" />
  ) : (
    <Text style={styles.empty}>
      Nothing here yet. Tick a habit off or finish something with a deadline and
      it will show up on this page the same day.
    </Text>
  );

  const footer =
    canLoadMore || loadingMore ? (
      <Pressable
        disabled={loadingMore}
        accessibilityRole="button"
        accessibilityLabel="Load older history"
        accessibilityState={{ busy: loadingMore }}
        onPress={loadMore}
        style={({ pressed }) => [styles.moreBtn, pressed && { opacity: 0.7 }]}
      >
        {loadingMore ? <Spinner size={18} /> : <Text style={styles.moreText}>OLDER</Text>}
      </Pressable>
    ) : null;

  return (
    /**
     * Opaque while there is nothing to show, transparent once there is.
     *
     * Screens are see-through so the drifting background reads through them,
     * which works because their cards cover the planner as they slide over it.
     * A screen holding only a spinner covers nothing, so the tracker underneath
     * showed straight through the entrance. Giving it a ground for exactly as
     * long as it is empty costs the background a few hundred milliseconds and
     * fixes it.
     */
    <SafeAreaView
      style={[styles.safe, loading && { backgroundColor: palette.bg }]}
      edges={['top', 'left', 'right', 'bottom']}
    >
      {/*
        A list rather than a scroller. Every day is a card of its own and an
        active year runs to hundreds of them; rendering the lot at once put
        roughly a thousand views on screen and took the frame time on Android to
        133ms against a 44ms baseline for the launcher on the same machine.
        Virtualised, only what is in view is mounted.
      */}
      <FlatList
        data={shown}
        keyExtractor={keyOf}
        renderItem={renderDay}
        contentContainerStyle={styles.content}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        ListFooterComponent={footer}
        ItemSeparatorComponent={Gap}
        showsVerticalScrollIndicator={false}
        initialNumToRender={8}
        maxToRenderPerBatch={8}
        windowSize={7}
        // detaching offscreen rows helps Android and has a history of leaving
        // blank patches on iOS, so it is asked for only where it pays
        removeClippedSubviews={Platform.OS === 'android'}
      />
    </SafeAreaView>
  );
}

const keyOf = (day: HistoryDay) => String(day.key);

/** Module-level so FlatList sees one stable separator type, not a new one each render */
const Gap = () => <View style={{ height: 14 }} />;

function Summary({
  value,
  label,
  tone,
  styles,
}: {
  value: number;
  label: string;
  tone: string;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <View style={styles.summaryCell}>
      <Text style={[styles.summaryValue, { color: tone }]}>{value}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </View>
  );
}

/**
 * One day's card.
 *
 * Memoised because the list re-renders whenever the filter changes or a page is
 * added, and none of that alters a day that was already on screen. `today` is
 * rounded to the day for the same reason: an unrounded clock would break every
 * comparison once a minute.
 */
const DayCard = React.memo(function DayCard({
  day,
  today,
  palette,
  styles,
}: {
  day: HistoryDay;
  today: number;
  palette: Palette;
  styles: ReturnType<typeof makeStyles>;
}) {
  const tally =
    day.habitCount > 0 && day.marks.length > 0 ? `${day.done}/${day.habitCount}` : undefined;

  return (
    <View style={styles.card}>
      <SectionHeader
        title={dayHeading(day, today)}
        right={
          tally ? (
            <View style={styles.tallyBadge}>
              <Text style={styles.tallyText}>{tally}</Text>
            </View>
          ) : undefined
        }
      />

      {day.marks.length > 0 && (
        <View style={styles.chips}>
          {day.marks.map((m, i) => {
            const isDone = m.state === 1;
            return (
              <View
                key={i}
                style={[
                  styles.chip,
                  {
                    backgroundColor: isDone ? palette.doneSoft : palette.missedSoft,
                    borderColor: isDone ? palette.done : palette.missed,
                  },
                ]}
              >
                <Text style={[styles.chipMark, { color: isDone ? palette.done : palette.missed }]}>
                  {isDone ? '✓' : '✕'}
                </Text>
                <Text style={styles.chipText} numberOfLines={1}>
                  {m.name}
                </Text>
              </View>
            );
          })}
        </View>
      )}

      {day.deadlines.map((event, i) => {
        const late = lateness(event);
        return (
          <View key={i} style={styles.deadlineRow}>
            <View style={[styles.deadlineDot, { backgroundColor: late ? palette.missed : palette.done }]} />
            <Text style={styles.deadlineText} numberOfLines={2}>
              {event.text}
            </Text>
            <Text style={[styles.deadlineWhen, late ? { color: palette.missed } : null]}>
              {late ?? 'on time'}
            </Text>
          </View>
        );
      })}
    </View>
  );
});

const makeStyles = (p: Palette) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: 'transparent' },
    content: {
      flexGrow: 1,
      paddingHorizontal: 16,
      paddingTop: 8,
      paddingBottom: 28,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 18,
      paddingHorizontal: 4,
    },
    title: {
      fontSize: 26,
      fontFamily: FONT.bold,
      letterSpacing: 2,
      color: p.ink,
    },
    closeBtn: {
      width: 44,
      height: 44,
      borderRadius: RADIUS.pill,
      borderWidth: 1,
      borderColor: p.lineFaint,
      backgroundColor: p.card,
      alignItems: 'center',
      justifyContent: 'center',
    },
    closeGlyph: {
      fontSize: 15,
      fontFamily: FONT.medium,
      color: p.ink,
      lineHeight: 18,
    },
    filter: {
      marginBottom: 16,
    },
    summary: {
      ...cardSurface(p),
      flexDirection: 'row',
      paddingVertical: 14,
      marginBottom: 18,
    },
    summaryCell: {
      flex: 1,
      alignItems: 'center',
    },
    summaryValue: {
      fontSize: 20,
      fontFamily: FONT.bold,
    },
    summaryLabel: {
      marginTop: 1,
      fontSize: 10,
      fontFamily: FONT.regular,
      letterSpacing: 0.5,
      color: p.inkSoft,
    },
    empty: {
      fontSize: 13,
      lineHeight: 20,
      fontFamily: FONT.regular,
      color: p.inkSoft,
      paddingHorizontal: 4,
    },
    card: {
      ...cardSurface(p),
      padding: 16,
    },
    tallyBadge: {
      backgroundColor: p.chip,
      borderRadius: RADIUS.chip,
      paddingHorizontal: 10,
      paddingVertical: 3,
    },
    tallyText: {
      fontSize: 11,
      fontFamily: FONT.bold,
      color: p.inkSoft,
    },
    chips: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
    },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      borderWidth: 1,
      borderRadius: RADIUS.chip,
      paddingVertical: 4,
      paddingLeft: 7,
      paddingRight: 9,
      maxWidth: '100%',
    },
    chipMark: {
      fontSize: 10,
      fontFamily: FONT.bold,
      marginRight: 5,
    },
    chipText: {
      flexShrink: 1,
      fontSize: 12,
      fontFamily: FONT.medium,
      color: p.ink,
    },
    deadlineRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: 10,
      gap: 9,
    },
    deadlineDot: {
      width: 7,
      height: 7,
      borderRadius: RADIUS.pill,
    },
    deadlineText: {
      flex: 1,
      fontSize: 13,
      fontFamily: FONT.semibold,
      color: p.ink,
    },
    deadlineWhen: {
      fontSize: 11,
      fontFamily: FONT.bold,
      color: p.inkSoft,
    },
    moreBtn: {
      marginTop: 18,
      height: 44,
      borderRadius: RADIUS.control,
      borderWidth: 1,
      borderColor: p.line,
      alignItems: 'center',
      justifyContent: 'center',
    },
    moreText: {
      fontSize: 11,
      fontFamily: FONT.bold,
      letterSpacing: 2,
      color: p.inkSoft,
    },
  });
