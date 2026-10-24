import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import ScreenHeader from '../components/ScreenHeader';
import SectionHeader, { CountBadge } from '../components/SectionHeader';
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
  occurrenceLabel,
} from '../history';
import { useHistory } from '../hooks/useHistory';
import { useNow } from '../hooks/useNow';
import { startOfDay } from '../dates';
import { COLUMN, FONT, Palette, RADIUS, SCALE, cardSurface, useTheme, wrapSafe } from '../theme';

/** What has already happened — habits ticked or missed, deadlines finished — newest first, read-only */

const FILTERS = [
  { value: 'all' as HistoryFilter, label: 'ALL' },
  { value: 'habits' as HistoryFilter, label: 'HABITS' },
  { value: 'deadlines' as HistoryFilter, label: 'DEADLINES' },
] as const;

interface Props {
  tasks: Task[];
  /** false while the screen is closed, so it doesn't read storage in the background */
  active: boolean;
  /** which tab to open on */
  initialFilter: HistoryFilter;
  onClose: () => void;
}

export default function HistoryScreen({ tasks, active, initialFilter, onClose }: Props) {
  const { palette } = useTheme();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const [filter, setFilter] = useState<HistoryFilter>(initialFilter);

  // adopt the requested tab on the way in only; after that it is the reader's choice
  useEffect(() => {
    if (active) setFilter(initialFilter);
  }, [active, initialFilter]);

  // a minute is plenty: only "TODAY" rolling over moves here
  const now = useNow(60_000);

  // rounded to the day, so the memoised cards don't re-render every minute
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

  // an element, not a component, so the segmented control isn't remounted
  const header = (
    <>
      <ScreenHeader
        title="HISTORY"
        closeLabel="Close history"
        onClose={onClose}
        style={styles.header}
      />

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
        {loadingMore ? (
          <Spinner size={18} />
        ) : (
          <Text style={styles.moreText} maxFontSizeMultiplier={SCALE.heading}>
            OLDER
          </Text>
        )}
      </Pressable>
    ) : null;

  return (
    // opaque while loading, or the planner shows through a screen with only a spinner
    <SafeAreaView
      style={[styles.safe, loading && { backgroundColor: palette.bg }]}
      edges={['top', 'left', 'right', 'bottom']}
    >
      {/* virtualised: an active year runs to hundreds of day cards */}
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
        // helps Android; on iOS it has left blank patches
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
      <Text style={[styles.summaryValue, { color: tone }]} maxFontSizeMultiplier={SCALE.figure}>
        {value}
      </Text>
      <Text style={styles.summaryLabel} maxFontSizeMultiplier={SCALE.figure}>
        {label}
      </Text>
    </View>
  );
}

/** One day's card, memoised: filter changes and new pages don't alter a day already shown */
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
  const { fontScale } = useWindowDimensions();
  const tally =
    day.habitCount > 0 && day.marks.length > 0 ? `${day.done}/${day.habitCount}` : undefined;

  return (
    <View style={styles.card}>
      <SectionHeader
        title={dayHeading(day, today)}
        right={tally ? <CountBadge label={tally} /> : undefined}
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
                <Text
                  style={[styles.chipMark, { color: isDone ? palette.done : palette.missed }]}
                  maxFontSizeMultiplier={SCALE.row}
                >
                  {isDone ? '✓' : '✕'}
                </Text>
                <Text
                  style={styles.chipText}
                  maxFontSizeMultiplier={SCALE.row}
                  numberOfLines={fontScale > 1 ? 2 : 1}
                >
                  {m.name}
                </Text>
              </View>
            );
          })}
        </View>
      )}

      {day.deadlines.map((event, i) => {
        const late = lateness(event);
        const occurrence = occurrenceLabel(event);
        return (
          <View key={i} style={styles.deadlineRow}>
            <View style={[styles.deadlineDot, { backgroundColor: late ? palette.missed : palette.done }]} />
            <View style={styles.deadlineBody}>
              <Text style={styles.deadlineText} maxFontSizeMultiplier={SCALE.row} numberOfLines={2}>
                {event.text}
              </Text>
              {occurrence && (
                <Text style={styles.deadlineOccurrence} maxFontSizeMultiplier={SCALE.figure}>
                  {occurrence}
                </Text>
              )}
            </View>
            <Text
              style={[styles.deadlineWhen, late ? { color: palette.missed } : null]}
              maxFontSizeMultiplier={SCALE.figure}
            >
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
      ...COLUMN,
      flexGrow: 1,
      paddingHorizontal: 16,
      paddingTop: 8,
      paddingBottom: 28,
    },
    header: {
      marginBottom: 18,
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
      lineHeight: wrapSafe(20),
      fontFamily: FONT.regular,
      color: p.inkSoft,
      paddingHorizontal: 4,
    },
    card: {
      ...cardSurface(p),
      padding: 16,
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
    deadlineBody: {
      flex: 1,
    },
    deadlineText: {
      fontSize: wrapSafe(13),
      fontFamily: FONT.semibold,
      color: p.ink,
    },
    deadlineOccurrence: {
      marginTop: 2,
      fontSize: 11,
      fontFamily: FONT.regular,
      color: p.inkSoft,
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
