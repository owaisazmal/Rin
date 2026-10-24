import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, LayoutAnimation, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import CustomCard from '../components/CustomCard';
import DailyCheck from '../components/DailyCheck';
import DayBars from '../components/DayBars';
import Deadlines from '../components/Deadlines';
import DueDatePicker from '../components/DueDatePicker';
import { EditIcon, HistoryIcon, SettingsIcon, SummaryIcon } from '../components/Glyphs';
import HabitBars from '../components/HabitBars';
import KeyboardSafeScroll from '../components/KeyboardSafeScroll';
import KeyGoals from '../components/KeyGoals';
import LayoutEditor from '../components/LayoutEditor';
import LogoMark from '../components/LogoMark';
import MonthNav from '../components/MonthNav';
import QuoteCard from '../components/QuoteCard';
import RadialTracker from '../components/RadialTracker';
import RoundButton from '../components/RoundButton';
import StreakBadge from '../components/StreakBadge';
import TrackerCard from '../components/TrackerCard';
import WeekdayHeat from '../components/WeekdayHeat';
import WeekTrend from '../components/WeekTrend';
import YearChart from '../components/YearChart';
import { useChartTransition } from '../hooks/useChartTransition';
import { useCurrentStreak } from '../hooks/useCurrentStreak';
import { monthDocKey, useMonthData } from '../hooks/useMonthData';
import { useNow } from '../hooks/useNow';
import { useReminderSync, useWidgetSync } from '../hooks/useOutboundSync';
import { TaskStore } from '../hooks/useTasks';
import { useYearSummary } from '../hooks/useYearSummary';
import { useYearWindow } from '../hooks/useYearWindow';
import { MONTH_NAMES, startOfDay } from '../dates';
import { dayWhen } from '../marking';
import { HistoryFilter } from '../history';
import {
  CardSlot,
  PlannerLayout,
  addCard,
  adoptCards,
  moveCard,
  removeCard,
  renameCard,
  toggleCard,
} from '../layout';
import { damagedNotice } from './backupWording';
import type { SummarySource } from './SummaryScreen';
import { ChartType, NotificationPrefs } from '../settings';
import { QuotePrefs, activeQuotes } from '../quotes';
import { CARD_PADDING, RAIL_TOP, SPLIT_MAX, plannerFit, usesSideRail } from '../fit';
import { COLUMN, FONT, Palette, cardSurface, useTheme, wrapSafe } from '../theme';
import { CardKind, CardRef, MAX_OBSERVATIONS, MAX_OBSERVATION_LEN, cardItemsIn } from '../types';

const rowsAnimation = LayoutAnimation.create(200, 'easeInEaseOut', 'opacity');

/** Wraps a list mutation so the rows animate open or closed around it */
function animateRows<A extends unknown[]>(fn: (...args: A) => void) {
  return (...args: A) => {
    LayoutAnimation.configureNext(rowsAnimation);
    fn(...args);
  };
}

/** The planner's layout and gestures; the month's data, saving and syncing live in hooks */
export default function PlannerScreen({
  chart,
  onSetChart,
  layout,
  onChangeLayout,
  notifications,
  quotes,
  onOpenSettings,
  onOpenHistory,
  onOpenSummary,
  taskStore,
  restorableMonth = null,
}: {
  chart: ChartType;
  onSetChart: (c: ChartType) => void;
  /** which cards sit below the daily check, and in what order */
  layout: PlannerLayout;
  /** takes a change rather than a layout, so two in one tick both land */
  onChangeLayout: (change: (prev: PlannerLayout) => PlannerLayout) => void;
  /** when reminders go out; a change reschedules them */
  notifications: NotificationPrefs;
  /** which quotes the card and the widgets rotate through */
  quotes: QuotePrefs;
  onOpenSettings: () => void;
  onOpenHistory: (filter?: HistoryFilter) => void;
  /** opens the summary of the month on screen */
  onOpenSummary: (source: SummarySource) => void;
  /** owned by the Navigator, because history reads the same list */
  taskStore: TaskStore;
  /** the month Settings is offering to restore, so the damage notice can point there */
  restorableMonth?: string | null;
}) {
  const { mode, palette } = useTheme();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const windowSize = useWindowDimensions();
  const insets = useSafeAreaInsets();

  // one clock: deadlines age on it and "today" rolls over with it
  const nowMs = useNow();
  const now = useMemo(() => new Date(nowMs), [nowMs]);

  const [year, setYear] = useState(() => now.getFullYear());
  const [month, setMonth] = useState(() => now.getMonth()); // 0-based
  const pendingSelect = useRef<number | null>(null);

  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth();
  const today = isCurrentMonth ? now.getDate() : null;
  const dayStart = startOfDay(nowMs);
  // what "today" is for the marking rule, stable until midnight
  const todayRef = useMemo(() => {
    const d = new Date(dayStart);
    return { year: d.getFullYear(), month: d.getMonth(), day: d.getDate() };
  }, [dayStart]);
  const [selectedDay, setSelectedDay] = useState(today ?? 1);

  const {
    data,
    loaded,
    vouched,
    daysInMonth,
    stats,
    flushSave,
    canMarkCell,
    setCell,
    cycleCell,
    addHabit: appendHabit,
    renameHabit,
    removeHabit: deleteHabit,
    habitHasMarks,
    findHabit,
    setGoalText,
    toggleGoalDone,
    setObservation,
    addObservation,
    removeObservation,
    setCardText,
    toggleCardItem,
    addCardItem,
    removeCardItem,
    retitleCard,
    dropCard,
  } = useMonthData(year, month, todayRef);

  const {
    tasks,
    loaded: tasksLoaded,
    vouched: tasksVouched,
    addTask,
    setTaskText,
    setTaskDue,
    toggleTaskDone,
    removeTask,
    findTask,
  } = taskStore;
  // which task's deadline is being edited, or null when the sheet is closed
  const [editingDue, setEditingDue] = useState<string | null>(null);
  const [editingLayout, setEditingLayout] = useState(false);

  /** A month restored from a backup can hold cards the layout does not know yet. */
  useEffect(() => {
    const held = data.cards;
    if (loaded && held?.length) onChangeLayout((prev) => adoptCards(prev, held));
  }, [loaded, data.cards, onChangeLayout]);

  const yearMonths = useYearSummary(year, month, data, daysInMonth);
  const streakDays = useCurrentStreak(year, yearMonths);
  // the year grid's own span, which crosses New Year, unlike the January-first yearMonths
  const yearWindow = useYearWindow({
    now: todayRef,
    browsedYear: year,
    browsedMonth: month,
    browsedMonths: yearMonths,
  });
  const quoteList = useMemo(() => activeQuotes(quotes), [quotes]);
  // wait for the deadlines too, or the widget would briefly say nothing is due
  useWidgetSync(loaded && tasksLoaded, year, month, data, yearMonths, mode, tasks, quoteList);
  useReminderSync(loaded && tasksLoaded, data, today, tasks, notifications);

  const { chartAnim, monthAnim, growAnim, enterFrom } = useChartTransition(chart, year * 12 + month);

  // a month opens on today, else the 1st, unless the year grid picked a date
  useEffect(() => {
    const n = new Date();
    setSelectedDay(
      pendingSelect.current ??
        (year === n.getFullYear() && month === n.getMonth() ? n.getDate() : 1)
    );
    pendingSelect.current = null;
  }, [year, month]);

  const shiftMonth = useCallback(
    (delta: number) => {
      flushSave();
      const d = new Date(year, month + delta, 1);
      setYear(d.getFullYear());
      setMonth(d.getMonth());
    },
    [flushSave, year, month]
  );

  // takes the year too: the year grid's months straddle New Year
  const gotoDate = useCallback(
    (y: number, m: number, day: number) => {
      if (y === year && m === month) {
        setSelectedDay(day);
        return;
      }
      flushSave();
      pendingSelect.current = day;
      setYear(y);
      setMonth(m);
    },
    [year, month, flushSave]
  );

  const addHabit = useMemo(() => animateRows(appendHabit), [appendHabit]);

  const removeHabit = useCallback(
    (id: string) => {
      const doRemove = animateRows(() => deleteHabit(id));
      if (!habitHasMarks(id)) {
        doRemove();
        return;
      }
      Alert.alert(
        'Remove habit?',
        `"${findHabit(id)?.name || 'This habit'}" has marks this month, and they will be deleted.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Remove', style: 'destructive', onPress: doRemove },
        ]
      );
    },
    [deleteHabit, habitHasMarks, findHabit]
  );

  /** The open month keeps its own copy of the title, for a restore to find. */
  const renameCustomCard = useCallback(
    (id: string, title: string) => {
      onChangeLayout((prev) => renameCard(prev, id, title));
      retitleCard(id, title);
    },
    [onChangeLayout, retitleCard]
  );

  /** Always confirms: the card may hold content in months not open here. */
  const deleteCustomCard = useCallback(
    (id: string) => {
      const name = layout.slots.find((slot) => slot.id === id)?.custom?.title.trim();
      Alert.alert(
        'Delete card?',
        `${name ? `"${name}"` : 'This card'} comes off every month, along with anything written in it.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: () => {
              onChangeLayout((prev) => removeCard(prev, id));
              dropCard(id);
            },
          },
        ]
      );
    },
    [layout.slots, onChangeLayout, dropCard]
  );

  /** One card below the daily check, by what the layout says goes there */
  const renderCard = (slot: CardSlot) => {
    switch (slot.id) {
      case 'deadlines':
        return (
          <Deadlines
            key={slot.id}
            tasks={tasks}
            now={nowMs}
            onAdd={animateRows(addTask)}
            onChangeText={setTaskText}
            onEditDue={setEditingDue}
            onToggleDone={animateRows(toggleTaskDone)}
            onRemove={animateRows(removeTask)}
            onShowHistory={() => onOpenHistory('deadlines')}
          />
        );
      case 'goals':
        return (
          <KeyGoals
            key={slot.id}
            goals={data.keyGoals}
            onChangeText={setGoalText}
            onToggleDone={toggleGoalDone}
          />
        );
      case 'observations':
        return (
          <CustomCard
            key={slot.id}
            title="Observations"
            kind="list"
            items={data.observations.map((text) => ({ text, done: false }))}
            maxItems={MAX_OBSERVATIONS}
            maxLength={MAX_OBSERVATION_LEN}
            onChangeText={setObservation}
            onAdd={animateRows(addObservation)}
            onRemove={animateRows(removeObservation)}
          />
        );
      case 'quote':
        return <QuoteCard key={slot.id} date={now} list={quoteList} />;
    }
    if (!slot.custom) return null;
    const card: CardRef = { id: slot.id, ...slot.custom };
    return (
      <CustomCard
        key={slot.id}
        title={card.title}
        kind={card.kind}
        items={cardItemsIn(data, card.id, card.kind)}
        onChangeText={(index, text) => setCardText(card, index, text)}
        onToggle={(index) => toggleCardItem(card, index)}
        onAdd={animateRows(() => addCardItem(card))}
        onRemove={animateRows((index: number) => removeCardItem(card, index))}
      />
    );
  };

  const openSummary = () => {
    if (!loaded) return;
    onOpenSummary({ year, month, data, vouched, yearMonths });
  };

  const shownSlots = layout.slots.filter((slot) => slot.shown);
  const fit = plannerFit(windowSize, insets);
  // with every card hidden there is nothing for a second column to hold
  const split = fit.split && shownSlots.length > 0;
  // a set width, not flex: Yoga keeps a stale flex basis when a live resize turns the stack into a row
  const columnStyle = split ? [styles.column, { width: fit.column }] : styles.stack;
  const rail = usesSideRail(insets);

  /** The tracker's chart; the month charts with no single day to land on keep their taps to themselves */
  const renderChart = () => {
    const shared = { year, month, data, today: todayRef, grow: growAnim, width: fit.column - 2 * CARD_PADDING };
    switch (chart) {
      case 'radial':
        return (
          <RadialTracker
            size={fit.chart}
            daysInMonth={daysInMonth}
            habits={data.habits}
            grid={data.grid}
            today={today}
            canMark={canMarkCell}
            selectedDay={selectedDay}
            onToggle={cycleCell}
            onSelectDay={setSelectedDay}
          />
        );
      case 'github':
        return yearWindow.blocks ? (
          <YearChart
            blocks={yearWindow.blocks}
            span={yearWindow.span}
            onSetSpan={yearWindow.setSpan}
            years={yearWindow.years}
            stats={yearWindow.stats}
            focus={{ year, month }}
            now={todayRef}
            selected={{ year, month, day: selectedDay }}
            onSelectDate={gotoDate}
          />
        ) : null;
      case 'days':
        return <DayBars {...shared} selectedDay={selectedDay} onSelectDay={setSelectedDay} />;
      case 'habits':
        return <HabitBars key={year * 12 + month} {...shared} />;
      case 'weeks':
        return <WeekTrend {...shared} selectedDay={selectedDay} onSelectDay={setSelectedDay} />;
      case 'weekdays':
        return <WeekdayHeat key={year * 12 + month} {...shared} />;
    }
  };

  const logo = (
    <View accessible accessibilityRole="image" accessibilityLabel="Rin">
      <LogoMark size={36} />
    </View>
  );
  const actions = (
    <>
      <StreakBadge days={streakDays} palette={palette} />
      {[
        { label: 'Month summary', onPress: openSummary, Icon: SummaryIcon },
        { label: 'Customize cards', onPress: () => setEditingLayout(true), Icon: EditIcon },
        { label: 'History', onPress: () => onOpenHistory(), Icon: HistoryIcon },
        { label: 'Settings', onPress: onOpenSettings, Icon: SettingsIcon },
      ].map(({ label, onPress, Icon }) => (
        <RoundButton key={label} label={label} onPress={onPress} hitSlop={4}>
          <Icon color={palette.ink} />
        </RoundButton>
      ))}
    </>
  );

  const notice = (text: string) => (
    <View style={styles.damaged}>
      <Text style={styles.damagedText}>{text}</Text>
    </View>
  );

  return (
    <View style={styles.screen}>
      <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
        <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />
        <KeyboardSafeScroll
          contentContainerStyle={[styles.content, split && styles.contentSplit]}
          // the card editor has fields of its own, and is drawn over this page
          keyboardElsewhere={editingLayout}
        >
          {rail ? null : (
            <View style={styles.header}>
              {logo}
              <View style={styles.headerActions}>{actions}</View>
            </View>
          )}

          <MonthNav
            year={year}
            month={month}
            onShift={shiftMonth}
            anim={monthAnim}
            enterFrom={enterFrom}
          />

          {/* a half-read record is never written back, so edits to it would be lost */}
          {loaded && !vouched
            ? notice(damagedNotice('month', restorableMonth === monthDocKey(year, month)))
            : null}
          {tasksLoaded && !tasksVouched ? notice(damagedNotice('deadlines')) : null}

          {/* the same tree either way, so folding or turning the phone keeps every card mounted */}
          <View style={split ? styles.columns : styles.stack}>
            <View style={columnStyle}>
              <TrackerCard
                chart={chart}
                onSetChart={onSetChart}
                anim={chartAnim}
                enterFrom={enterFrom}
                stats={stats}
                hasHabits={data.habits.length > 0}
              >
                {renderChart()}
              </TrackerCard>

              <DailyCheck
                day={selectedDay}
                daysInMonth={daysInMonth}
                monthName={MONTH_NAMES[month]}
                when={dayWhen(year, month, selectedDay, todayRef)}
                canMark={(habitId) => canMarkCell(selectedDay, habitId)}
                habits={data.habits}
                grid={data.grid}
                onSet={setCell}
                onShiftDay={(d) =>
                  setSelectedDay((prev) => Math.min(Math.max(prev + d, 1), daysInMonth))
                }
                onAdd={addHabit}
                onRename={renameHabit}
                onRemove={removeHabit}
              />
            </View>

            {/* Arranged in the layout editor; a hidden card is not drawn. */}
            <View style={columnStyle}>{shownSlots.map(renderCard)}</View>
          </View>
        </KeyboardSafeScroll>

        <DueDatePicker
          visible={editingDue !== null}
          value={findTask(editingDue ?? '')?.due ?? nowMs}
          repeat={findTask(editingDue ?? '')?.repeat?.every ?? null}
          onCancel={() => setEditingDue(null)}
          onConfirm={(due, repeat) => {
            if (editingDue) setTaskDue(editingDue, due, repeat);
            setEditingDue(null);
          }}
        />

        <LayoutEditor
          visible={editingLayout}
          layout={layout}
          onToggle={(id) => onChangeLayout((prev) => toggleCard(prev, id))}
          onMove={(id, by) => onChangeLayout((prev) => moveCard(prev, id, by))}
          onRename={renameCustomCard}
          onRemove={deleteCustomCard}
          onAdd={(title: string, kind: CardKind) =>
            onChangeLayout((prev) => addCard(prev, title, kind))
          }
          onClose={() => setEditingLayout(false)}
        />
      </SafeAreaView>
      {/* in the Duo's status column, so they stay put while the page scrolls */}
      {rail ? (
        <View style={[styles.rail, { top: RAIL_TOP, width: insets.right }]}>
          {logo}
          {actions}
        </View>
      ) : null}
    </View>
  );
}

const makeStyles = (p: Palette) =>
  StyleSheet.create({
    screen: { flex: 1 },
    safe: {
      flex: 1,
      backgroundColor: 'transparent',
    },
    /** the gap spaces every card, so none of them carries a margin of its own */
    content: {
      ...COLUMN,
      paddingHorizontal: 16,
      paddingTop: 8,
      paddingBottom: 48,
      gap: 14,
    },
    contentSplit: { maxWidth: SPLIT_MAX },
    stack: { gap: 14 },
    columns: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
    column: { gap: 14 },
    /** the actions drop below the mark when a narrow screen or large text leaves no room */
    header: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'space-between',
      alignItems: 'center',
      rowGap: 8,
      marginBottom: 4,
      paddingHorizontal: 4,
    },
    headerActions: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'flex-end',
      alignItems: 'center',
      flexShrink: 1,
      marginLeft: 'auto',
      gap: 8,
    },
    rail: { position: 'absolute', right: 0, alignItems: 'center', gap: 10 },
    damaged: {
      ...cardSurface(p),
      borderColor: p.accent,
      paddingVertical: 14,
      paddingHorizontal: 16,
    },
    damagedText: {
      fontSize: 12,
      fontFamily: FONT.regular,
      lineHeight: wrapSafe(18),
      color: p.ink,
    },
  });
