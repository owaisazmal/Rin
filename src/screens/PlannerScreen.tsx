import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  LayoutAnimation,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import CustomCard from '../components/CustomCard';
import DailyCheck from '../components/DailyCheck';
import Deadlines from '../components/Deadlines';
import DueDatePicker from '../components/DueDatePicker';
import EditIcon from '../components/EditIcon';
import HistoryIcon from '../components/HistoryIcon';
import KeyboardSafeScroll from '../components/KeyboardSafeScroll';
import KeyGoals from '../components/KeyGoals';
import LayoutEditor from '../components/LayoutEditor';
import LogoMark from '../components/LogoMark';
import MonthNav from '../components/MonthNav';
import Observations from '../components/Observations';
import QuoteCard from '../components/QuoteCard';
import RadialTracker from '../components/RadialTracker';
import SettingsIcon from '../components/SettingsIcon';
import StreakBadge from '../components/StreakBadge';
import TrackerCard from '../components/TrackerCard';
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
import { ChartType } from '../settings';
import { COLUMN, FONT, Palette, RADIUS, cardSurface, useTheme, wrapSafe } from '../theme';
import { CardKind, CardRef, cardItemsIn } from '../types';

const rowsAnimation = LayoutAnimation.create(200, 'easeInEaseOut', 'opacity');

/**
 * Wraps a list mutation so the rows animate open or closed around it. Done
 * here rather than in the hooks: the list moving is a property of this screen,
 * not of the month's data.
 */
function animateRows<A extends unknown[]>(fn: (...args: A) => void) {
  return (...args: A) => {
    LayoutAnimation.configureNext(rowsAnimation);
    fn(...args);
  };
}

/**
 * The planner itself: layout and gestures only. What a month contains, how it
 * persists, and what gets pushed to the widgets and the notification schedule
 * all live in hooks, and the tracker card and the month bar carry their own
 * motion, so this file reads as the screen's shape.
 */
export default function PlannerScreen({
  chart,
  onSetChart,
  layout,
  onChangeLayout,
  onOpenSettings,
  onOpenHistory,
  taskStore,
  restorableMonth = null,
}: {
  chart: ChartType;
  onSetChart: (c: ChartType) => void;
  /** which cards sit below the daily check, and in what order */
  layout: PlannerLayout;
  /** takes a change rather than a layout, so two in one tick both land */
  onChangeLayout: (change: (prev: PlannerLayout) => PlannerLayout) => void;
  onOpenSettings: () => void;
  onOpenHistory: (filter?: HistoryFilter) => void;
  /** owned by the Navigator, because history reads the same list */
  taskStore: TaskStore;
  /**
   * The month Settings is offering to put back, by document name, or null.
   *
   * The notice below tells somebody that writing in a damaged month lets go of
   * what did not survive, and until this existed that was the end of it — the
   * remedy lived behind a card they had no reason to open. This is that remedy,
   * handed down as a name so the screen need learn nothing about backups to
   * point at it: whether there is a copy, whether anything has looked, and what
   * looking costs are all decided above the Navigator. All this screen does is
   * notice that the month being warned about is the month being offered.
   *
   * Defaulted rather than required, because a caller with no answer is the
   * ordinary case and the notice is completely true without the clause.
   */
  restorableMonth?: string | null;
}) {
  const { mode, palette } = useTheme();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const { width } = useWindowDimensions();

  // One clock for everything that depends on the date: the deadlines age on
  // it, and "today" rolls over with it at midnight.
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
  /*
    The year grid's own span, which is not the browsed year. It opens on the
    twelve months up to this one — a span that crosses New Year, and so cannot
    be the calendar-year array above: that one is a contract the streak badge,
    the widget snapshot and both native widget targets index as January-first.
  */
  const yearWindow = useYearWindow({
    now: { year: now.getFullYear(), month: now.getMonth(), day: now.getDate() },
    browsedYear: year,
    browsedMonth: month,
    browsedMonths: yearMonths,
  });
  // Both, not just the month: pushing before the deadlines have loaded would
  // put a snapshot on the home screen saying nothing is due, and only correct
  // it on the next edit.
  useWidgetSync(loaded && tasksLoaded, year, month, data, yearMonths, mode, tasks);
  useReminderSync(loaded && tasksLoaded, data, today, tasks);

  const { chartAnim, monthAnim, enterFrom } = useChartTransition(chart, year * 12 + month);

  // Opening a month lands on today when it's the current one, on the 1st
  // otherwise — unless a date was picked from the year grid on the way in.
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

  /**
   * Takes the year as well as the month, because the grid it is called from
   * shows the twelve months up to this one and those straddle New Year —
   * moving on the month alone would land a tap on last December in this year's
   * December, silently.
   */
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
        `"${findHabit(id)?.name || 'This habit'}" has marks this month — they will be deleted.`,
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
          <Observations
            key={slot.id}
            observations={data.observations}
            onChange={setObservation}
            onAdd={animateRows(addObservation)}
            onRemove={animateRows(removeObservation)}
          />
        );
      case 'quote':
        return <QuoteCard key={slot.id} date={now} />;
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

  const chartSize = Math.min(width - 64, 420);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />
      {/*
        The keyboard handling — getting out of its way, putting the focused
        field where it can be seen, and what does and does not dismiss it —
        all lives in the wrapper. Padding on Android as well as iOS, for the
        reason set out there: the app draws edge to edge, so the window no
        longer shrinks when the keyboard opens.
      */}
      <KeyboardSafeScroll
        contentContainerStyle={styles.content}
        // the card editor has fields of its own, and is drawn over this page
        keyboardElsewhere={editingLayout}
      >
        <View style={styles.header}>
          <View accessible accessibilityRole="image" accessibilityLabel="Rin">
            <LogoMark size={36} />
          </View>
          <View style={styles.headerActions}>
            <StreakBadge days={streakDays} palette={palette} />
            <Pressable
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Customize cards"
              onPress={() => setEditingLayout(true)}
              style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.6 }]}
            >
              <EditIcon color={palette.ink} />
            </Pressable>
            <Pressable
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="History"
              onPress={() => onOpenHistory()}
              style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.6 }]}
            >
              <HistoryIcon color={palette.ink} />
            </Pressable>
            <Pressable
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Settings"
              onPress={onOpenSettings}
              style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.6 }]}
            >
              <SettingsIcon color={palette.ink} />
            </Pressable>
          </View>
        </View>

        <MonthNav
          year={year}
          month={month}
          onShift={shiftMonth}
          anim={monthAnim}
          enterFrom={enterFrom}
        />

        {/*
          A record this phone could only half read is drawn but never written
          back, so anything typed into it goes nowhere. That has to be said
          out loud and at the top: the alternative is a month that accepts
          edits all afternoon and keeps none of them. Both notices can be up
          at once — they are two different records — and each waits for its
          own load, since nothing is vouched for before it has been read.
        */}
        {loaded && !vouched ? (
          <View style={styles.damaged}>
            <Text style={styles.damagedText}>
              {/*
                The clause about Settings appears for the month it is
                actually about and for no other. Comparing the names rather
                than taking a bare flag is what keeps that exact: the card
                offers one document at a time, and a phone with two damaged
                months would otherwise carry the promise into the one that
                has no copy waiting for it.
              */}
              {damagedNotice('month', restorableMonth === monthDocKey(year, month))}
            </Text>
          </View>
        ) : null}
        {tasksLoaded && !tasksVouched ? (
          <View style={styles.damaged}>
            <Text style={styles.damagedText}>{damagedNotice('deadlines')}</Text>
          </View>
        ) : null}

        <TrackerCard
          chart={chart}
          onSetChart={onSetChart}
          anim={chartAnim}
          enterFrom={enterFrom}
          stats={stats}
          hasHabits={data.habits.length > 0}
        >
          {chart === 'radial' ? (
            <RadialTracker
              size={chartSize}
              daysInMonth={daysInMonth}
              habits={data.habits}
              grid={data.grid}
              today={today}
              canMark={canMarkCell}
              selectedDay={selectedDay}
              onToggle={cycleCell}
              onSelectDay={setSelectedDay}
            />
          ) : yearWindow.blocks ? (
            <YearChart
              blocks={yearWindow.blocks}
              span={yearWindow.span}
              onSetSpan={yearWindow.setSpan}
              years={yearWindow.years}
              stats={yearWindow.stats}
              focus={{ year, month }}
              now={{ year: now.getFullYear(), month: now.getMonth(), day: now.getDate() }}
              selected={{ year, month, day: selectedDay }}
              onSelectDate={gotoDate}
            />
          ) : null}
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

        {/* Arranged in the layout editor; a hidden card is not drawn. */}
        {layout.slots.filter((slot) => slot.shown).map(renderCard)}
      </KeyboardSafeScroll>

      <DueDatePicker
        visible={editingDue !== null}
        value={findTask(editingDue ?? '')?.due ?? nowMs}
        onCancel={() => setEditingDue(null)}
        onConfirm={(due) => {
          if (editingDue) setTaskDue(editingDue, due);
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
  );
}

const makeStyles = (p: Palette) =>
  StyleSheet.create({
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
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 4,
      paddingHorizontal: 4,
    },
    headerActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    iconBtn: {
      width: 44,
      height: 44,
      borderRadius: RADIUS.pill,
      borderWidth: 1,
      borderColor: p.lineFaint,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: p.card,
    },
    /**
     * The one card on this screen that is not part of the month. It takes the
     * accent border the tracker's alerts use rather than the quiet card
     * surface, because it is the difference between typing that is kept and
     * typing that is not.
     */
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
