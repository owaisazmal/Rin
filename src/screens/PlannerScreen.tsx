import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  LayoutAnimation,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import DailyCheck from '../components/DailyCheck';
import Deadlines from '../components/Deadlines';
import DueDatePicker from '../components/DueDatePicker';
import HabitsList from '../components/HabitsList';
import HistoryIcon from '../components/HistoryIcon';
import KeyGoals from '../components/KeyGoals';
import LogoMark from '../components/LogoMark';
import MonthNav from '../components/MonthNav';
import Observations from '../components/Observations';
import RadialTracker from '../components/RadialTracker';
import SettingsIcon from '../components/SettingsIcon';
import StreakBadge from '../components/StreakBadge';
import TrackerCard from '../components/TrackerCard';
import YearChart from '../components/YearChart';
import { useChartTransition } from '../hooks/useChartTransition';
import { useCurrentStreak } from '../hooks/useCurrentStreak';
import { useMonthData } from '../hooks/useMonthData';
import { useNow } from '../hooks/useNow';
import { useReminderSync, useWidgetSync } from '../hooks/useOutboundSync';
import { TaskStore } from '../hooks/useTasks';
import { useYearSummary } from '../hooks/useYearSummary';
import { MONTH_NAMES } from '../dates';
import { HistoryFilter } from '../history';
import { quoteForDate } from '../quotes';
import { ChartType } from '../settings';
import { FONT, Palette, RADIUS, cardSurface, useTheme } from '../theme';

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
  onOpenSettings,
  onOpenHistory,
  taskStore,
}: {
  chart: ChartType;
  onSetChart: (c: ChartType) => void;
  onOpenSettings: () => void;
  onOpenHistory: (filter?: HistoryFilter) => void;
  /** owned by the Navigator, because history reads the same list */
  taskStore: TaskStore;
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
  const [selectedDay, setSelectedDay] = useState(today ?? 1);

  const {
    data,
    loaded,
    daysInMonth,
    stats,
    flushSave,
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
  } = useMonthData(year, month, today);

  const {
    tasks,
    loaded: tasksLoaded,
    addTask,
    setTaskText,
    setTaskDue,
    toggleTaskDone,
    removeTask,
    findTask,
  } = taskStore;
  // which task's deadline is being edited, or null when the sheet is closed
  const [editingDue, setEditingDue] = useState<string | null>(null);

  const yearMonths = useYearSummary(year, month, data, daysInMonth);
  const streakDays = useCurrentStreak(year, yearMonths);
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

  const gotoDate = useCallback(
    (m: number, day: number) => {
      if (m === month) {
        setSelectedDay(day);
        return;
      }
      flushSave();
      pendingSelect.current = day;
      setMonth(m);
    },
    [month, flushSave]
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

  const chartSize = Math.min(width - 64, 420);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            {/*
              The mark shares the eyebrow line rather than sitting beside the
              whole wordmark: PLANNING at full size plus the three actions
              already fills a 400pt screen, so anything to its left would push
              the settings button off the edge.
            */}
            <View>
              <View style={styles.brand}>
                <LogoMark size={28} />
                <Text style={styles.headerSub}>MONTHLY</Text>
              </View>
              <Text style={styles.headerTitle}>PLANNING</Text>
            </View>
            <View style={styles.headerActions}>
              <StreakBadge days={streakDays} palette={palette} />
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
                selectedDay={selectedDay}
                onToggle={cycleCell}
                onSelectDay={setSelectedDay}
              />
            ) : yearMonths ? (
              <YearChart
                year={year}
                months={yearMonths}
                focusMonth={month}
                now={{ year: now.getFullYear(), month: now.getMonth(), day: now.getDate() }}
                selected={{ month, day: selectedDay }}
                onSelectDate={gotoDate}
              />
            ) : null}
          </TrackerCard>

          <DailyCheck
            day={selectedDay}
            daysInMonth={daysInMonth}
            monthName={MONTH_NAMES[month]}
            isToday={selectedDay === today}
            todayDay={today}
            habits={data.habits}
            grid={data.grid}
            onSet={setCell}
            onShiftDay={(d) =>
              setSelectedDay((prev) => Math.min(Math.max(prev + d, 1), daysInMonth))
            }
          />

          <Deadlines
            tasks={tasks}
            now={nowMs}
            onAdd={animateRows(addTask)}
            onChangeText={setTaskText}
            onEditDue={setEditingDue}
            onToggleDone={animateRows(toggleTaskDone)}
            onRemove={animateRows(removeTask)}
            onShowHistory={() => onOpenHistory('deadlines')}
          />

          <HabitsList
            habits={data.habits}
            onRename={renameHabit}
            onAdd={addHabit}
            onRemove={removeHabit}
          />

          <KeyGoals goals={data.keyGoals} onChangeText={setGoalText} onToggleDone={toggleGoalDone} />

          <Observations
            observations={data.observations}
            onChange={setObservation}
            onAdd={animateRows(addObservation)}
            onRemove={animateRows(removeObservation)}
          />

          <View style={styles.quoteCard}>
            <View style={styles.quoteHead}>
              <View style={styles.accent} />
              <Text style={styles.quoteLabel}>DISCIPLINE.</Text>
            </View>
            <Text style={styles.quote}>“{quoteForDate(now)}”</Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <DueDatePicker
        visible={editingDue !== null}
        value={findTask(editingDue ?? '')?.due ?? nowMs}
        onCancel={() => setEditingDue(null)}
        onConfirm={(due) => {
          if (editingDue) setTaskDue(editingDue, due);
          setEditingDue(null);
        }}
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
    flex: {
      flex: 1,
    },
    /** the gap spaces every card, so none of them carries a margin of its own */
    content: {
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
    brand: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginBottom: 2,
    },
    headerSub: {
      fontSize: 11,
      fontFamily: FONT.bold,
      letterSpacing: 4,
      color: p.accent,
      // Josefin sits high in its box; nudge the caps onto the mark's centreline
      marginTop: 3,
    },
    headerTitle: {
      fontSize: 30,
      fontFamily: FONT.bold,
      letterSpacing: 1,
      color: p.ink,
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
    quoteCard: {
      ...cardSurface(p),
      marginTop: 2,
      paddingVertical: 16,
      paddingHorizontal: 18,
    },
    // an inline accent bar, matching every other section — a borderLeft would
    // detach into a floating arc against the card's large corner radius
    quoteHead: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 6,
    },
    accent: {
      width: 4,
      height: 15,
      borderRadius: 2,
      backgroundColor: p.accent,
      marginRight: 8,
    },
    quoteLabel: {
      fontSize: 12,
      fontFamily: FONT.bold,
      letterSpacing: 2,
      color: p.accent,
    },
    quote: {
      fontSize: 13,
      // the italic family carries the slant; fontStyle would be ignored here
      fontFamily: FONT.italic,
      lineHeight: 19,
      color: p.inkSoft,
    },
  });
