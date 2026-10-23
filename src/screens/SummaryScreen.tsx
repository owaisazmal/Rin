import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import SectionHeader from '../components/SectionHeader';
import { MONTH_NAMES } from '../dates';
import { device } from '../device';
import { useNow } from '../hooks/useNow';
import { HabitRate, MonthSummary, summarizeMonth } from '../monthSummary';
import { YearMonthSummary, loadYearSummary } from '../storage';
import { Task } from '../tasks';
import { MonthData } from '../types';
import { COLUMN, FONT, Palette, RADIUS, SCALE, cardSurface, useTheme, wrapSafe } from '../theme';

/** The month the planner had open when the summary was asked for */
export interface SummarySource {
  year: number;
  /** 0-based */
  month: number;
  data: MonthData;
  /** false when the stored month could only be partly read */
  vouched: boolean;
  /** the browsed year from useYearSummary, or null before it has loaded */
  yearMonths: YearMonthSummary[] | null;
}

interface Props {
  source: SummarySource | null;
  tasks: Task[];
  onClose: () => void;
}

type Styles = ReturnType<typeof makeStyles>;

const monthName = (m: number) => MONTH_NAMES[m][0] + MONTH_NAMES[m].slice(1).toLowerCase();

/** "+3", "−3" or "0", with a real minus sign */
const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0');

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "Read · 90%", or every habit tied there, counted once there are more than three */
function tied(habits: HabitRate[]): string {
  const names = habits.length > 3 ? `${habits.length} habits` : habits.map((h) => h.name).join(', ');
  return `${names} · ${habits[0].pct}%`;
}

/** The month before, from the planner's year when it has it, otherwise read from storage */
function usePreviousMonth(source: SummarySource | null): YearMonthSummary | null {
  const before = source ? new Date(source.year, source.month - 1, 1) : null;
  const held =
    source && before && before.getFullYear() === source.year
      ? source.yearMonths?.[before.getMonth()] ?? null
      : null;
  const [read, setRead] = useState<{ source: SummarySource; month: YearMonthSummary } | null>(
    null
  );

  useEffect(() => {
    if (!source || held) return;
    let cancelled = false;
    const at = new Date(source.year, source.month - 1, 1);
    loadYearSummary(at.getFullYear()).then((months) => {
      if (!cancelled) setRead({ source, month: months[at.getMonth()] });
    });
    return () => {
      cancelled = true;
    };
  }, [source, held]);

  if (held) return held;
  return read?.source === source ? read.month : null;
}

/** Read-only; the month is changed in the planner */
export default function SummaryScreen({ source, tasks, onClose }: Props) {
  const { palette } = useTheme();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const now = useNow(60_000);
  const previous = usePreviousMonth(source);

  const summary = useMemo(
    () =>
      source ? summarizeMonth(source.year, source.month, source.data, tasks, now, previous) : null,
    [source, tasks, now, previous]
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View style={styles.titleBlock}>
            <Text
              style={styles.title}
              accessibilityRole="header"
              maxFontSizeMultiplier={SCALE.heading}
            >
              SUMMARY
            </Text>
            {source ? (
              <Text style={styles.subtitle} maxFontSizeMultiplier={SCALE.figure}>
                {MONTH_NAMES[source.month]} {source.year}
              </Text>
            ) : null}
          </View>
          <Pressable
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Close summary"
            onPress={onClose}
            style={({ pressed }) => [styles.closeBtn, pressed && { opacity: 0.6 }]}
          >
            <Text style={styles.closeGlyph} maxFontSizeMultiplier={SCALE.glyph}>
              ✕
            </Text>
          </Pressable>
        </View>

        {source && !source.vouched ? (
          <View style={styles.damaged}>
            <Text style={styles.damagedText}>
              Rin could not read all of this month on this {device()}, so these numbers cover only
              the part that survived.
            </Text>
          </View>
        ) : null}

        {source && summary ? (
          <Body summary={summary} month={source.month} palette={palette} styles={styles} />
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function Body({
  summary: s,
  month,
  palette,
  styles,
}: {
  summary: MonthSummary;
  month: number;
  palette: Palette;
  styles: Styles;
}) {
  const name = monthName(month);
  const d = s.deadlines;
  const deadlineCount = d.met + d.late + d.overdue + d.open;
  const nothing =
    s.habitCount === 0 && s.goals.total === 0 && deadlineCount === 0 && !s.observations.length;

  if (nothing) {
    return (
      <View style={styles.card}>
        <Text style={styles.note}>
          {s.phase === 'future'
            ? `${name} has not started yet. What you plan for it will be summed up here as the month goes.`
            : s.phase === 'current'
              ? `Nothing in ${name} yet. Add a habit, set a goal or give something a deadline, and it will be summed up here.`
              : `Nothing was recorded in ${name}.`}
        </Text>
      </View>
    );
  }

  const tracking = s.habitCount > 0 && s.phase !== 'future';
  const comparing =
    s.previous &&
    s.phase !== 'future' &&
    (s.habitCount > 0 || s.previous.totals.habitCount > 0);

  return (
    <>
      <Overview summary={s} name={name} palette={palette} styles={styles} />

      {tracking && s.habits.length ? (
        <View style={styles.card}>
          <SectionHeader title="HABITS" />
          {s.best.length ? (
            <View style={styles.facts}>
              <Fact label="Best" value={tied(s.best)} styles={styles} />
              <Fact label="Weakest" value={tied(s.weakest)} styles={styles} />
            </View>
          ) : null}
          <View style={styles.habitList}>
            {s.habits.map((h) => (
              <HabitRow key={h.id} habit={h} palette={palette} styles={styles} />
            ))}
          </View>
        </View>
      ) : null}

      {comparing && s.previous ? (
        <View style={styles.card}>
          <SectionHeader title={`VS ${MONTH_NAMES[s.previous.month]}`} />
          {s.phase === 'current' ? (
            <Text style={[styles.note, styles.noteGap]}>
              {name} so far, against all of {monthName(s.previous.month)}. The counts are still
              growing.
            </Text>
          ) : null}
          <Change
            label="Completion"
            from={s.previous.totals.pct === null ? '–' : `${s.previous.totals.pct}%`}
            to={s.pct === null ? '–' : `${s.pct}%`}
            delta={s.previous.change.pct}
            unit=" pts"
            palette={palette}
            styles={styles}
          />
          <Change
            label="Done"
            from={String(s.previous.totals.done)}
            to={String(s.done)}
            delta={s.previous.change.done}
            judged={s.phase === 'past'}
            palette={palette}
            styles={styles}
          />
          <Change
            label="Missed"
            from={String(s.previous.totals.missed)}
            to={String(s.missed)}
            delta={s.previous.change.missed}
            lowerIsBetter
            judged={s.phase === 'past'}
            palette={palette}
            styles={styles}
          />
          <Change
            label="Longest streak"
            from={String(s.previous.totals.longestStreak)}
            to={plural(s.longestStreak, 'day')}
            delta={s.previous.change.longestStreak}
            judged={s.phase === 'past'}
            palette={palette}
            styles={styles}
          />
        </View>
      ) : null}

      <View style={styles.card}>
        <SectionHeader
          title="KEY GOALS"
          right={
            s.goals.total ? (
              <View style={styles.badge}>
                <Text style={styles.badgeText} maxFontSizeMultiplier={SCALE.figure}>
                  {s.goals.done}/{s.goals.total}
                </Text>
              </View>
            ) : undefined
          }
        />
        {s.goals.total ? (
          <View style={styles.list}>
            {s.goals.named.map((g, i) => (
              <View
                key={i}
                accessible
                accessibilityLabel={`${g.text.trim()}, ${g.done ? 'done' : 'not done'}`}
                style={[styles.row, g.done && styles.rowDone]}
              >
                <Text style={[styles.rowMark, { color: g.done ? palette.done : palette.inkSoft }]}>
                  {g.done ? '✓' : '○'}
                </Text>
                <Text style={styles.rowText}>{g.text.trim()}</Text>
              </View>
            ))}
          </View>
        ) : (
          <Text style={styles.note}>
            {s.phase === 'past' ? `No key goals were set for ${name}.` : 'No key goals set yet.'}
          </Text>
        )}
      </View>

      <View style={styles.card}>
        <SectionHeader title="DEADLINES" />
        {deadlineCount ? (
          <View style={styles.strip}>
            <Stat value={d.met} label="met" tone={palette.done} styles={styles} />
            <Stat value={d.late} label="late" tone={palette.missed} styles={styles} />
            <Stat value={d.overdue} label="missed" tone={palette.missed} styles={styles} />
            {s.phase !== 'past' ? (
              <Stat value={d.open} label="open" tone={palette.inkSoft} styles={styles} />
            ) : null}
          </View>
        ) : (
          <Text style={styles.note}>No deadlines fell due in {name}.</Text>
        )}
      </View>

      <View style={styles.card}>
        <SectionHeader title="OBSERVATIONS" />
        {s.observations.length ? (
          <View style={styles.list}>
            {s.observations.map((text, i) => (
              <View key={i} style={styles.row}>
                <Text style={styles.rowText}>{text}</Text>
              </View>
            ))}
          </View>
        ) : (
          <Text style={styles.note}>
            {s.phase === 'past' ? `No observations were written in ${name}.` : 'No observations yet.'}
          </Text>
        )}
      </View>
    </>
  );
}

function Overview({
  summary: s,
  name,
  palette,
  styles,
}: {
  summary: MonthSummary;
  name: string;
  palette: Palette;
  styles: Styles;
}) {
  const daysLeft = s.daysInMonth - s.daysPast;
  let note: string | null = null;
  if (s.habitCount === 0) {
    note =
      s.phase === 'past'
        ? `No habits were tracked in ${name}.`
        : `No habits in ${name} yet. Add them in the daily check on the planner.`;
  } else if (s.phase === 'future') {
    note = `${name} has not started yet.`;
  } else if (s.pct === null) {
    note = 'Nothing to count yet. A day counts once it is over or once something in it is marked.';
  }

  return (
    <View style={styles.card}>
      <SectionHeader
        title="COMPLETION"
        right={
          s.phase === 'current' && !note ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText} maxFontSizeMultiplier={SCALE.figure}>
                SO FAR
              </Text>
            </View>
          ) : undefined
        }
      />
      {note ? (
        <Text style={styles.note}>{note}</Text>
      ) : (
        <>
          <View
            accessible
            accessibilityLabel={`${s.pct} percent done${s.phase === 'current' ? ' so far' : ''}`}
            style={styles.hero}
          >
            <Text style={styles.heroValue} maxFontSizeMultiplier={SCALE.figure}>
              {s.pct}%
            </Text>
            <Text style={styles.heroCaption}>
              {s.phase === 'current'
                ? `${plural(daysLeft, 'day')} to go, today included`
                : `of ${plural(s.habitCount, 'habit')} over ${s.daysInMonth} days`}
            </Text>
          </View>
          <View style={styles.strip}>
            <Stat value={s.done} label="done" tone={palette.done} styles={styles} />
            <Stat value={s.missed} label="missed" tone={palette.missed} styles={styles} />
            <Stat value={s.empty} label="empty" tone={palette.inkSoft} styles={styles} />
          </View>
          <View style={styles.facts}>
            <Fact label="Longest streak" value={plural(s.longestStreak, 'day')} styles={styles} />
          </View>
        </>
      )}
    </View>
  );
}

function Stat({
  value,
  label,
  tone,
  styles,
}: {
  value: number;
  label: string;
  tone: string;
  styles: Styles;
}) {
  return (
    <View accessible accessibilityLabel={`${value} ${label}`} style={styles.stat}>
      <Text
        style={[styles.statValue, { color: value ? tone : styles.statLabel.color }]}
        maxFontSizeMultiplier={SCALE.figure}
      >
        {value}
      </Text>
      <Text style={styles.statLabel} maxFontSizeMultiplier={SCALE.figure}>
        {label}
      </Text>
    </View>
  );
}

function Fact({ label, value, styles }: { label: string; value: string; styles: Styles }) {
  return (
    <View accessible accessibilityLabel={`${label}: ${value}`} style={styles.fact}>
      <Text style={styles.factLabel}>{label}</Text>
      <Text style={styles.factValue}>{value}</Text>
    </View>
  );
}

function HabitRow({
  habit: h,
  palette,
  styles,
}: {
  habit: HabitRate;
  palette: Palette;
  styles: Styles;
}) {
  return (
    <View
      accessible
      accessibilityLabel={
        h.pct === null
          ? `${h.name}, nothing to count yet`
          : `${h.name}, ${h.pct} percent, ${h.done} done, ${h.missed} missed, ${h.empty} empty`
      }
    >
      <View style={styles.habitHead}>
        <Text style={styles.habitName} numberOfLines={2}>
          {h.name}
        </Text>
        <Text style={styles.habitPct}>{h.pct === null ? '–' : `${h.pct}%`}</Text>
      </View>
      <View style={styles.track}>
        <View style={{ flex: h.done, backgroundColor: palette.done }} />
        <View style={{ flex: h.missed, backgroundColor: palette.missed }} />
        <View style={{ flex: h.empty }} />
      </View>
    </View>
  );
}

function Change({
  label,
  from,
  to,
  delta,
  unit = '',
  lowerIsBetter = false,
  judged = true,
  palette,
  styles,
}: {
  label: string;
  from: string;
  to: string;
  delta: number | null;
  unit?: string;
  lowerIsBetter?: boolean;
  /** false while the month is still running, so a smaller count is not read as worse */
  judged?: boolean;
  palette: Palette;
  styles: Styles;
}) {
  const better = delta !== null && delta > 0 !== lowerIsBetter;
  const tone =
    !judged || delta === null || delta === 0
      ? palette.inkSoft
      : better
        ? palette.done
        : palette.missed;
  return (
    <View
      accessible
      accessibilityLabel={`${label}: ${from} before, ${to} now${
        delta === null ? '' : `, ${delta === 0 ? 'no change' : `${signed(delta)}${unit}`}`
      }`}
      style={styles.change}
    >
      <Text style={styles.changeLabel}>{label}</Text>
      <Text style={styles.changeValues}>
        {from} → {to}
      </Text>
      <Text style={[styles.changeDelta, { color: tone }]}>
        {delta === null ? '–' : `${signed(delta)}${unit}`}
      </Text>
    </View>
  );
}

const makeStyles = (p: Palette) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: 'transparent' },
    content: {
      ...COLUMN,
      paddingHorizontal: 16,
      paddingTop: 8,
      paddingBottom: 28,
      gap: 14,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 4,
      paddingHorizontal: 4,
      gap: 12,
    },
    titleBlock: { flexShrink: 1 },
    title: {
      fontSize: 26,
      fontFamily: FONT.bold,
      letterSpacing: 2,
      color: p.ink,
    },
    subtitle: {
      marginTop: 2,
      fontSize: 12,
      fontFamily: FONT.bold,
      letterSpacing: 2,
      color: p.inkSoft,
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
    card: {
      ...cardSurface(p),
      padding: 18,
    },
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
    note: {
      fontSize: 13,
      lineHeight: wrapSafe(20),
      fontFamily: FONT.regular,
      color: p.inkSoft,
    },
    noteGap: { marginBottom: 6 },
    badge: {
      backgroundColor: p.chip,
      borderRadius: RADIUS.chip,
      paddingHorizontal: 10,
      paddingVertical: 3,
    },
    badgeText: {
      fontSize: 11,
      fontFamily: FONT.bold,
      letterSpacing: 0.5,
      color: p.inkSoft,
    },
    hero: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'baseline',
      columnGap: 10,
      marginBottom: 14,
    },
    heroValue: {
      fontSize: 44,
      fontFamily: FONT.bold,
      color: p.ink,
    },
    heroCaption: {
      flexShrink: 1,
      fontSize: wrapSafe(12),
      fontFamily: FONT.regular,
      color: p.inkSoft,
    },
    strip: {
      flexDirection: 'row',
      backgroundColor: p.chip,
      borderRadius: RADIUS.control,
      paddingVertical: 12,
    },
    stat: {
      flex: 1,
      alignItems: 'center',
    },
    statValue: {
      fontSize: 20,
      fontFamily: FONT.bold,
    },
    statLabel: {
      marginTop: 1,
      fontSize: 10,
      fontFamily: FONT.regular,
      letterSpacing: 0.5,
      color: p.inkSoft,
    },
    facts: {
      marginTop: 12,
      gap: 8,
    },
    fact: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'space-between',
      columnGap: 12,
    },
    factLabel: {
      fontSize: wrapSafe(13),
      fontFamily: FONT.regular,
      color: p.inkSoft,
    },
    factValue: {
      flexShrink: 1,
      fontSize: wrapSafe(13),
      fontFamily: FONT.bold,
      color: p.ink,
      textAlign: 'right',
    },
    habitList: {
      marginTop: 14,
      gap: 14,
    },
    habitHead: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      marginBottom: 6,
    },
    habitName: {
      flex: 1,
      fontSize: wrapSafe(13),
      fontFamily: FONT.semibold,
      color: p.ink,
    },
    habitPct: {
      fontSize: 13,
      fontFamily: FONT.bold,
      color: p.ink,
    },
    track: {
      flexDirection: 'row',
      height: 8,
      borderRadius: RADIUS.pill,
      overflow: 'hidden',
      backgroundColor: p.cellEmpty,
    },
    change: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'baseline',
      columnGap: 10,
      paddingVertical: 8,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: p.lineFaint,
    },
    changeLabel: {
      flex: 1,
      minWidth: 110,
      fontSize: wrapSafe(13),
      fontFamily: FONT.regular,
      color: p.inkSoft,
    },
    changeValues: {
      fontSize: 13,
      fontFamily: FONT.semibold,
      color: p.ink,
    },
    changeDelta: {
      minWidth: 52,
      fontSize: 13,
      fontFamily: FONT.bold,
      textAlign: 'right',
    },
    list: { gap: 8 },
    row: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 10,
      backgroundColor: p.chip,
      borderRadius: RADIUS.control,
      borderWidth: 1,
      borderColor: 'transparent',
      paddingVertical: 10,
      paddingHorizontal: 14,
    },
    rowDone: {
      backgroundColor: p.doneSoft,
      borderColor: p.done,
    },
    rowMark: {
      fontSize: 13,
      fontFamily: FONT.bold,
      lineHeight: wrapSafe(19),
    },
    rowText: {
      flex: 1,
      fontSize: 13,
      fontFamily: FONT.regular,
      lineHeight: wrapSafe(19),
      color: p.ink,
    },
  });
