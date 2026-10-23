import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  AppState,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import SectionHeader from '../components/SectionHeader';
import SegmentedControl from '../components/SegmentedControl';
import ThemeIcon from '../components/ThemeIcon';
import ThemeBackdrop from '../components/ThemeBackdrop';
import TimePicker from '../components/TimePicker';
import QuoteEditor from '../components/QuoteEditor';
import { CheckGlyph, CloseGlyph } from '../components/Glyphs';
import { DeadlineLead, MAX_SLOTS, NotificationPrefs, placeSlot } from '../settings';
import { DISCIPLINE_QUOTES, MAX_CUSTOM_QUOTES, QuotePrefs, QuoteSource, placeQuote } from '../quotes';
import { notificationsBlocked } from '../notifications';
import { listStoredMonths } from '../storage';
import {
  ExportFile,
  ExportFormat,
  ExportScope,
  exportCsv,
  exportFileName,
  exportJson,
  exportNotice,
  gatherExport,
  scopeTitle,
} from '../exportData';
import { shareExport } from '../exportFile';
import type { BackupStatus } from '../hooks/useAutoBackup';
import { backupCard, nameOf, restoreFailure } from './backupWording';
import { device } from '../device';
import type { BackupHolds, RestoreFailure } from './backupWording';
import {
  COLUMN,
  FONT,
  Palette,
  RADIUS,
  SCALE,
  ThemePreference,
  cardSurface,
  useTheme,
  wrapSafe,
} from '../theme';

const THEME_OPTIONS = [
  { value: 'dark' as ThemePreference, label: 'DARK' },
  { value: 'light' as ThemePreference, label: 'LIGHT' },
  { value: 'system' as ThemePreference, label: 'SYSTEM' },
] as const;

const LEAD_OPTIONS: { id: DeadlineLead; label: string; spoken: string }[] = [
  { id: '3d', label: '3 DAYS', spoken: 'Three days before' },
  { id: '1d', label: '1 DAY', spoken: 'One day before' },
  { id: '3h', label: '3 HRS', spoken: 'Three hours before' },
  { id: '1h', label: '1 HR', spoken: 'One hour before' },
  { id: 'due', label: 'DUE', spoken: 'When it is due' },
];

const SOURCE_OPTIONS = [
  { value: 'builtin' as QuoteSource, label: 'BUILT-IN' },
  { value: 'mine' as QuoteSource, label: 'MINE' },
  { value: 'both' as QuoteSource, label: 'BOTH' },
] as const;

const FORMAT_OPTIONS = [
  { value: 'json' as ExportFormat, label: 'JSON' },
  { value: 'csv' as ExportFormat, label: 'CSV' },
] as const;

const SCOPE_OPTIONS = [
  { value: 'month' as ExportScope['kind'], label: 'MONTH' },
  { value: 'year' as ExportScope['kind'], label: 'YEAR' },
  { value: 'all' as ExportScope['kind'], label: 'ALL' },
] as const;

function quoteSummary({ source, custom }: QuotePrefs): string {
  const builtIn = DISCIPLINE_QUOTES.length;
  if (source === 'builtin') return `The ${builtIn} that come with Rin, one a day`;
  if (custom.length === 0) return 'The built-in ones until you add your own';
  if (source === 'mine') {
    return custom.length === 1 ? 'Your one quote, every day' : `Your ${custom.length}, one a day`;
  }
  return `${builtIn} built-in and ${custom.length} of yours, one a day`;
}

/** where a new reminder's picker starts */
const NEW_SLOT = { hour: 9, minute: 0 };

const hhmm = (hour: number, minute: number) =>
  `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

const REPO_URL = 'https://github.com/owaisazmal/monthly-planning';
const PRIVACY_URL = 'https://owaisazmal.github.io/Rin/privacy.html';

interface Props {
  hasBackup: boolean;
  lastBackupAt: number | null;
  backupStatus: BackupStatus;
  onOpenBackup: () => void;
  /**
   * Take the park off everything the last run was refused and try the lot again.
   *
   * Offered only when something is stuck, and it is the half of the recovery
   * story the card could not tell before. A refusal is remembered against the
   * version of the document it happened to, so editing that document is what
   * brings it back — which works for a month somebody trims and works for
   * nothing else. A server that turned this install away is not fixed by typing
   * in September, and neither is a month shortened by hand outside the app.
   */
  onRetryBackup: () => Promise<void>;
  /**
   * Which documents the backup is known to hold, or null when nothing has
   * looked. Optional so a caller that has not got the answer says nothing
   * rather than guessing — see `BackupHolds`, where the difference between "not
   * there" and "not asked" is the whole point.
   */
  backupHolds?: BackupHolds;
  /**
   * Pull one month back down over this phone's damaged copy of it.
   *
   * The way out of the trap the card has only ever been able to describe. A
   * month this phone could not read in full is drawn from the survivors and
   * never sent, so the whole copy stays safe on the server — and the only
   * remedy on offer was to write in the month again, which turns the thinned
   * version into a healthy record and sends it over the better one. This is the
   * same repair made in the direction that keeps the data.
   *
   * Optional, and the offer is withheld unless it is here: a sentence promising
   * a restore over a card with no button on it would be worse than the warning
   * it replaced.
   */
  onRestoreMonth?: (key: string) => Promise<RestoreFailure | null>;
  /**
   * Erase the backup itself, rather than this phone's copy of the code.
   *
   * The other half of leaving. Forgetting the code stops this phone using the
   * backup and leaves every document standing, which is what somebody changing
   * phones wants; this is for somebody who wants their data off the server, and
   * until it existed there was no way to do that at all.
   */
  onDeleteBackup: () => Promise<{ ok: boolean; deleted: number }>;
  onForgetBackup: () => void;
  /** when reminders go out; held in App with the rest of the settings */
  notifications: NotificationPrefs;
  onChangeNotifications: (change: (prev: NotificationPrefs) => NotificationPrefs) => void;
  /** which quotes the planner's card shows, and the user's own */
  quotes: QuotePrefs;
  onChangeQuotes: (change: (prev: QuotePrefs) => QuotePrefs) => void;
  onClose: () => void;
}

/**
 * Where the backup card's words come from.
 *
 * Not from here. `backupWording.ts` decides every sentence on it out of the
 * ledger's account of this phone, and it is a separate file because the suite
 * runs in plain Node while this one imports React Native — and because every
 * bug that card has had was a sentence rather than a layout, which is exactly
 * the kind of thing a test can hold still and read.
 */
export default function SettingsScreen({
  hasBackup,
  lastBackupAt,
  backupStatus,
  onOpenBackup,
  onRetryBackup,
  onDeleteBackup,
  backupHolds,
  onRestoreMonth,
  onForgetBackup,
  notifications,
  onChangeNotifications: change,
  quotes,
  onChangeQuotes,
  onClose,
}: Props) {
  const { mode, preference, palette, setPreference } = useTheme();
  const styles = useMemo(() => makeStyles(palette), [palette]);

  // which slot's time is being set: an index, 'new' for an added one, or null
  const [editing, setEditing] = useState<number | 'new' | null>(null);
  const editSlot = typeof editing === 'number' ? notifications.slots[editing] : NEW_SLOT;

  // rechecked on return to the app, which is how someone comes back from the system settings
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    const check = () => notificationsBlocked().then(setBlocked);
    check();
    // again once the reminder sync has had its say, since a silent refusal comes back from there
    const later = setTimeout(check, 2500);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') check();
    });
    return () => {
      clearTimeout(later);
      sub.remove();
    };
  }, [notifications]);
  const anyOn =
    (notifications.habits && notifications.slots.some((s) => s.on)) || notifications.deadlines;

  // which of the user's quotes is being written: an index, 'new', or null
  const [writing, setWriting] = useState<number | 'new' | null>(null);
  const removeQuote = (text: string) =>
    Alert.alert(
      'Remove this quote?',
      `“${text}”`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () =>
            onChangeQuotes((q) => ({ ...q, custom: q.custom.filter((c) => c !== text) })),
        },
      ],
      { cancelable: true }
    );

  // the months the export can pick from, oldest first as the store lists them
  const [stored, setStored] = useState<{ year: number; month: number }[]>([]);
  const years = useMemo(() => [...new Set(stored.map((m) => m.year))], [stored]);
  const [format, setFormat] = useState<ExportFormat>('json');
  const [scopeKind, setScopeKind] = useState<ExportScope['kind']>('month');
  const [monthAt, setMonthAt] = useState(0);
  const [yearAt, setYearAt] = useState(0);
  useEffect(() => {
    listStoredMonths().then((list) => {
      const now = new Date();
      const month = list.findIndex(
        (m) => m.year === now.getFullYear() && m.month === now.getMonth()
      );
      const yearList = [...new Set(list.map((m) => m.year))];
      const year = yearList.indexOf(now.getFullYear());
      setStored(list);
      setMonthAt(month >= 0 ? month : list.length - 1);
      setYearAt(year >= 0 ? year : yearList.length - 1);
    });
  }, []);
  const picked = stored[monthAt];
  const scope: ExportScope | null =
    scopeKind === 'all'
      ? { kind: 'all' }
      : scopeKind === 'month'
        ? picked
          ? { kind: 'month', year: picked.year, month: picked.month }
          : null
        : years[yearAt] !== undefined
          ? { kind: 'year', year: years[yearAt] }
          : null;
  const stepAt = scopeKind === 'month' ? monthAt : yearAt;
  const stepCount = scopeKind === 'month' ? stored.length : years.length;
  const step = (delta: number) =>
    (scopeKind === 'month' ? setMonthAt : setYearAt)((at) =>
      Math.min(stepCount - 1, Math.max(0, at + delta))
    );

  const [exporting, setExporting] = useState(false);
  const send = async (file: ExportFile, chosen: ExportScope, as: ExportFormat) => {
    try {
      const body = as === 'json' ? exportJson(file) : exportCsv(file);
      await shareExport(exportFileName(chosen, as, Date.now()), body, as);
    } catch {
      Alert.alert('Nothing was exported', `Rin could not make the file on this ${device()}.`);
    }
  };
  /** Reads everything first, so the warning can name any month that is damaged */
  const startExport = async () => {
    if (exporting || !scope) return;
    setExporting(true);
    let file: ExportFile;
    try {
      file = await gatherExport(scope);
    } catch {
      Alert.alert('Nothing was exported', `Rin could not read this ${device()}'s data. Try again.`);
      return;
    } finally {
      setExporting(false);
    }
    Alert.alert(
      'This file is not encrypted',
      exportNotice(file, format),
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Export', onPress: () => send(file, scope, format) },
      ],
      { cancelable: true }
    );
  };

  /**
   * The card is told what the backup holds only when there is something this
   * screen could do about the answer. Without a handler there is no button to
   * draw, and a card that named a restore nobody could reach would be a worse
   * dead end than the one it was written to open.
   */
  const card = backupCard(backupStatus, lastBackupAt, onRestoreMonth ? backupHolds ?? null : null);
  /** The month the card is offering to pull back, if it is offering one */
  const damagedMonth = card.restore;

  /**
   * The retry is the one action here that takes a noticeable moment — it signs
   * in, re-reads every stuck document and offers it again — so it says so.
   * Nothing is reported back on the way out: the card is read from the ledger
   * and re-publishes itself the moment the run is over, which is the same
   * sentence arriving from the place that actually knows.
   */
  const [retrying, setRetrying] = useState(false);
  const retry = async () => {
    if (retrying) return;
    setRetrying(true);
    try {
      await onRetryBackup();
    } finally {
      setRetrying(false);
    }
  };

  /**
   * The restore, which is the one destructive thing this screen can do to
   * somebody's own data, so it asks first and says exactly what it costs.
   *
   * The wording is the same trade the card's sentence makes, said again at the
   * moment of the tap: the backup's copy replaces this phone's, and whatever
   * was typed into that month after the record went bad is part of what is
   * replaced. Nobody should discover that afterwards.
   */
  const [restoring, setRestoring] = useState(false);
  const restore = (key: string) => {
    if (restoring || !onRestoreMonth) return;
    Alert.alert(
      `Restore ${nameOf(key)}?`,
      `This replaces this ${device()}'s damaged copy of that month with the one in the backup. Anything written in it since the damage is lost with it. Nothing else on this ${device()} is touched.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Restore',
          style: 'destructive',
          onPress: async () => {
            setRestoring(true);
            try {
              // Only a failure is announced. A restore that worked retires the
              // damage note, so the card redraws saying so from the place that
              // actually knows — and a second dialog agreeing with it would be
              // one more thing to dismiss.
              const failed = await onRestoreMonth(key);
              if (failed) Alert.alert(`${nameOf(key)} was not restored`, restoreFailure(failed));
            } finally {
              setRestoring(false);
            }
          },
        },
      ],
      { cancelable: true }
    );
  };

  /**
   * Scrolling is switched off while the page already fits, which is the normal
   * case: the clip panel takes the leftover space, so the layout sizes itself
   * to the screen rather than running past it.
   *
   * That is not tidiness. The clip's field is dropped out with a blend mode,
   * and Android abandons the offscreen layer a blend mode needs the moment a
   * scroll container starts handling a drag, so the raw black field snapped
   * back for the length of the gesture. Measured on the emulator: the panel
   * sits 2 levels off the page at rest, fell to 44 levels under a drag, and
   * holds at 1 with the scroller inert.
   *
   * It switches back on the moment the content genuinely overflows, which a
   * large accessibility font or a short screen can cause. Settings you cannot
   * reach would be a far worse fault than a decoration that flickers.
   */
  const [viewport, setViewport] = useState(0);
  const [contentHeight, setContentHeight] = useState(0);
  const scrollable = contentHeight > viewport + 1;

  const [deleting, setDeleting] = useState(false);
  /**
   * The destructive one, and the only thing in the app that reaches across and
   * removes somebody's data from the server. It says what goes and what stays,
   * because the two are easy to confuse: the backup is erased, the months on
   * this phone are not.
   */
  const confirmDelete = () =>
    Alert.alert(
      'Delete the backup?',
      `Everything in the backup is erased for good, and no code can bring it back, not yours and not mine. What is on this ${device()} stays exactly as it is.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setDeleting(true);
            try {
              const done = await onDeleteBackup();
              if (!done.ok) {
                Alert.alert(
                  'The backup was not fully deleted',
                  done.deleted > 0
                    ? `${done.deleted} of its records were removed before Rin lost the connection. Deleting again will finish the job.`
                    : 'Rin could not reach the backup, so nothing was removed. Try again when you have a connection.'
                );
              }
            } finally {
              setDeleting(false);
            }
          },
        },
      ],
      { cancelable: true }
    );

  const confirmForget = () =>
    Alert.alert(
      'Forget the code?',
      `This ${device()} stops backing up. The backup itself stays where it is, and anyone with the code written down can still restore it.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Forget', style: 'destructive', onPress: onForgetBackup },
      ],
      { cancelable: true }
    );

  // 'bottom' matters now that the colophon is pinned down there: without it the
  // last line sits under Android's gesture pill.
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right', 'bottom']}>
      <ScrollView
        contentContainerStyle={styles.content}
        scrollEnabled={scrollable}
        // Android's stretch at either end of the scroll draws the page into a
        // layer of its own, where the clip has nothing behind it to blend with
        // and its raw field shows. No stretch, no field.
        overScrollMode="never"
        onLayout={(e) => setViewport(e.nativeEvent.layout.height)}
        onContentSizeChange={(_, h) => setContentHeight(h)}
      >
        <View style={styles.header}>
          <Text style={styles.title} maxFontSizeMultiplier={SCALE.heading}>
            SETTINGS
          </Text>
          <Pressable
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Close settings"
            onPress={onClose}
            style={({ pressed }) => [styles.closeBtn, pressed && { opacity: 0.6 }]}
          >
            <Text style={styles.closeGlyph} maxFontSizeMultiplier={SCALE.glyph}>
              ✕
            </Text>
          </Pressable>
        </View>

        <SectionHeader title="BACKUP" />
        <View style={styles.card}>
          {hasBackup ? (
            <>
              <Text style={[styles.emptyTitle, card.attention && styles.alertTitle]}>
                {card.title}
              </Text>
              <Text style={[styles.emptyBody, card.attention && styles.alertBody]}>
                {card.body}
              </Text>
              <Pressable
                onPress={onOpenBackup}
                style={({ pressed }) => [styles.primary, pressed && { opacity: 0.85 }]}
              >
                <Text style={styles.primaryText} maxFontSizeMultiplier={SCALE.heading}>
                  BACK UP NOW
                </Text>
              </Pressable>
              {/*
                Above the generic retry, because it is the answer to the
                sentence the card has just finished saying. Trying again does
                nothing for a month this phone cannot read — the next run reads
                the same damaged record and declines to send it for the same
                reason — and this is the only control on the screen that changes
                that.
              */}
              {damagedMonth !== null ? (
                <Pressable
                  disabled={restoring}
                  onPress={() => restore(damagedMonth)}
                  style={({ pressed }) => [styles.ghostBtn, pressed && { opacity: 0.7 }]}
                >
                  <Text
                    style={[styles.ghostText, styles.retryText]}
                    maxFontSizeMultiplier={SCALE.heading}
                  >
                    {restoring ? 'RESTORING…' : 'RESTORE THIS MONTH'}
                  </Text>
                </Pressable>
              ) : null}
              {card.retry ? (
                <Pressable
                  disabled={retrying}
                  onPress={retry}
                  style={({ pressed }) => [styles.ghostBtn, pressed && { opacity: 0.7 }]}
                >
                  <Text
                    style={[styles.ghostText, styles.retryText]}
                    maxFontSizeMultiplier={SCALE.heading}
                  >
                    {retrying ? 'TRYING…' : 'TRY IT AGAIN NOW'}
                  </Text>
                </Pressable>
              ) : null}
              <Pressable
                onPress={confirmForget}
                style={({ pressed }) => [styles.ghostBtn, pressed && { opacity: 0.7 }]}
              >
                <Text style={styles.ghostText} maxFontSizeMultiplier={SCALE.heading}>
                  FORGET THE CODE
                </Text>
              </Pressable>
              {/*
                Last, and worded as the heavier thing it is. Forgetting the code
                is reversible by anyone who wrote it down; this is not reversible
                by anybody.
              */}
              <Pressable
                disabled={deleting}
                onPress={confirmDelete}
                style={({ pressed }) => [styles.ghostBtn, pressed && { opacity: 0.7 }]}
              >
                <Text
                  style={[styles.ghostText, styles.dangerText]}
                  maxFontSizeMultiplier={SCALE.heading}
                >
                  {deleting ? 'DELETING…' : 'DELETE THE BACKUP'}
                </Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={styles.emptyTitle}>No backup</Text>
              <Text style={styles.emptyBody}>
                Everything works without one. A backup carries your months to your
                next {device()}, encrypted with a code only you hold.
              </Text>
              <Pressable
                onPress={onOpenBackup}
                style={({ pressed }) => [styles.primary, pressed && { opacity: 0.85 }]}
              >
                <Text style={styles.primaryText} maxFontSizeMultiplier={SCALE.heading}>
                  SET ONE UP
                </Text>
              </Pressable>
            </>
          )}
        </View>

        <SectionHeader title="EXPORT" />
        <View style={styles.card}>
          <View style={styles.quoteHead}>
            <Text style={styles.rowTitle} maxFontSizeMultiplier={SCALE.row}>
              Export to a file
            </Text>
            <Text style={styles.rowSub} maxFontSizeMultiplier={SCALE.row}>
              {format === 'json'
                ? 'Months, deadlines, settings and quotes, in full'
                : 'One row per habit per day, for spreadsheets'}
            </Text>
          </View>
          <SegmentedControl
            options={FORMAT_OPTIONS}
            value={format}
            onChange={setFormat}
            verticalPadding={9}
          />
          <SegmentedControl
            options={SCOPE_OPTIONS}
            value={scopeKind}
            onChange={setScopeKind}
            verticalPadding={9}
            style={styles.scopeControl}
          />
          {scopeKind !== 'all' ? (
            <View style={[styles.slotRow, styles.stepper]}>
              <Pressable
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={scopeKind === 'month' ? 'Earlier month' : 'Earlier year'}
                disabled={stepAt <= 0}
                onPress={() => step(-1)}
                style={({ pressed }) => [
                  styles.removeBtn,
                  stepAt <= 0 && styles.off,
                  pressed && { opacity: 0.6 },
                ]}
              >
                <Text style={styles.stepArrow} maxFontSizeMultiplier={SCALE.glyph}>
                  ‹
                </Text>
              </Pressable>
              <Text style={styles.stepLabel} maxFontSizeMultiplier={SCALE.row}>
                {scope ? scopeTitle(scope) : 'No months yet'}
              </Text>
              <Pressable
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={scopeKind === 'month' ? 'Later month' : 'Later year'}
                disabled={stepAt >= stepCount - 1}
                onPress={() => step(1)}
                style={({ pressed }) => [
                  styles.removeBtn,
                  stepAt >= stepCount - 1 && styles.off,
                  pressed && { opacity: 0.6 },
                ]}
              >
                <Text style={styles.stepArrow} maxFontSizeMultiplier={SCALE.glyph}>
                  ›
                </Text>
              </Pressable>
            </View>
          ) : null}
          <Pressable
            disabled={exporting || !scope}
            onPress={startExport}
            style={({ pressed }) => [
              styles.ghostBtn,
              !scope && styles.off,
              pressed && { opacity: 0.7 },
            ]}
          >
            <Text
              style={[styles.ghostText, styles.retryText]}
              maxFontSizeMultiplier={SCALE.heading}
            >
              {exporting ? 'READING…' : 'EXPORT'}
            </Text>
          </Pressable>
          <Text style={[styles.rowSub, styles.exportNote]} maxFontSizeMultiplier={SCALE.row}>
            The file is not encrypted. Rin uploads nothing; it goes only where you send it.
          </Text>
        </View>

        <SectionHeader title="NOTIFICATIONS" />
        <View style={styles.card}>
          {blocked && anyOn ? (
            <>
              <Text style={[styles.emptyTitle, styles.alertTitle]}>Notifications are off</Text>
              <Text style={[styles.emptyBody, styles.alertBody]}>
                This {device()} isn’t letting Rin send them, so none of the reminders below will
                arrive.
              </Text>
              <Pressable
                onPress={() => Linking.openSettings()}
                style={({ pressed }) => [styles.ghostBtn, pressed && { opacity: 0.7 }]}
              >
                <Text
                  style={[styles.ghostText, styles.retryText]}
                  maxFontSizeMultiplier={SCALE.heading}
                >
                  OPEN SETTINGS
                </Text>
              </Pressable>
              <View style={styles.divider} />
            </>
          ) : null}
          <ToggleRow
            styles={styles}
            palette={palette}
            title="Habit reminders"
            sub="Only while something is still unticked"
            on={notifications.habits}
            onPress={() => change((p) => ({ ...p, habits: !p.habits }))}
          />
          {notifications.habits ? (
            <>
              {notifications.slots.map((slot, i) => {
                const time = hhmm(slot.hour, slot.minute);
                return (
                  <View key={i} style={styles.slotRow}>
                    <Pressable
                      hitSlop={10}
                      accessibilityRole="switch"
                      accessibilityState={{ checked: slot.on }}
                      accessibilityLabel={`Reminder at ${time}`}
                      onPress={() =>
                        change((p) => ({
                          ...p,
                          slots: p.slots.map((s, j) => (j === i ? { ...s, on: !s.on } : s)),
                        }))
                      }
                      style={({ pressed }) => [
                        styles.toggle,
                        slot.on && styles.toggleOn,
                        pressed && { opacity: 0.6 },
                      ]}
                    >
                      {slot.on && <CheckGlyph color={palette.onAccent} size={13} />}
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Change the ${time} reminder`}
                      onPress={() => setEditing(i)}
                      style={({ pressed }) => [styles.slotTime, pressed && { opacity: 0.6 }]}
                    >
                      <Text
                        style={[styles.slotTimeText, !slot.on && styles.off]}
                        maxFontSizeMultiplier={SCALE.row}
                      >
                        {time}
                      </Text>
                    </Pressable>
                    {notifications.slots.length > 1 ? (
                      <Pressable
                        hitSlop={10}
                        accessibilityRole="button"
                        accessibilityLabel={`Remove the ${time} reminder`}
                        onPress={() =>
                          change((p) =>
                            p.slots.length > 1
                              ? { ...p, slots: p.slots.filter((_, j) => j !== i) }
                              : p
                          )
                        }
                        style={({ pressed }) => [styles.removeBtn, pressed && { opacity: 0.6 }]}
                      >
                        <CloseGlyph color={palette.inkSoft} size={13} />
                      </Pressable>
                    ) : null}
                  </View>
                );
              })}
              {notifications.slots.length < MAX_SLOTS ? (
                <Pressable
                  onPress={() => setEditing('new')}
                  style={({ pressed }) => [styles.addBtn, pressed && { opacity: 0.7 }]}
                >
                  <Text style={styles.ghostText} maxFontSizeMultiplier={SCALE.heading}>
                    ADD A TIME
                  </Text>
                </Pressable>
              ) : null}
              <ToggleRow
                styles={styles}
                palette={palette}
                title="All-done message"
                sub="A well-done in place of the next nudge"
                on={notifications.allDone}
                onPress={() => change((p) => ({ ...p, allDone: !p.allDone }))}
              />
            </>
          ) : null}

          <View style={styles.divider} />

          <ToggleRow
            styles={styles}
            palette={palette}
            title="Deadline reminders"
            sub="Before each deadline"
            on={notifications.deadlines}
            onPress={() => change((p) => ({ ...p, deadlines: !p.deadlines }))}
          />
          {notifications.deadlines ? (
            <View style={styles.chips}>
              {LEAD_OPTIONS.map(({ id, label, spoken }) => {
                const on = notifications.leads[id];
                return (
                  <Pressable
                    key={id}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                    accessibilityLabel={spoken}
                    onPress={() =>
                      change((p) => ({ ...p, leads: { ...p.leads, [id]: !p.leads[id] } }))
                    }
                    style={({ pressed }) => [
                      styles.chip,
                      on && styles.chipOn,
                      pressed && { opacity: 0.7 },
                    ]}
                  >
                    <Text
                      style={[styles.chipText, on && styles.chipTextOn]}
                      maxFontSizeMultiplier={SCALE.heading}
                    >
                      {label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}
          {notifications.deadlines ? (
            <View style={styles.missedRow}>
              <ToggleRow
                styles={styles}
                palette={palette}
                title="Missed deadlines"
                sub="One more nudge the morning after"
                on={notifications.overdue}
                onPress={() => change((p) => ({ ...p, overdue: !p.overdue }))}
              />
            </View>
          ) : null}
        </View>

        <TimePicker
          visible={editing !== null}
          title={editing === 'new' ? 'NEW REMINDER' : 'REMINDER'}
          hour={editSlot?.hour ?? NEW_SLOT.hour}
          minute={editSlot?.minute ?? NEW_SLOT.minute}
          onCancel={() => setEditing(null)}
          onConfirm={(hour, minute) => {
            const index = editing === 'new' ? null : editing;
            change((p) => ({ ...p, slots: placeSlot(p.slots, index, hour, minute) }));
            setEditing(null);
          }}
        />

        <SectionHeader title="QUOTES" />
        <View style={styles.card}>
          <View style={styles.quoteHead}>
            <Text style={styles.rowTitle} maxFontSizeMultiplier={SCALE.row}>
              Daily quote
            </Text>
            <Text style={styles.rowSub} maxFontSizeMultiplier={SCALE.row}>
              {quoteSummary(quotes)}
            </Text>
          </View>
          <SegmentedControl
            options={SOURCE_OPTIONS}
            value={quotes.source}
            onChange={(source) => onChangeQuotes((q) => ({ ...q, source }))}
            verticalPadding={9}
          />
          {quotes.custom.map((text, i) => (
            <View key={text} style={[styles.slotRow, styles.quoteRow]}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Edit quote: ${text}`}
                onPress={() => setWriting(i)}
                style={({ pressed }) => [styles.quoteText, pressed && { opacity: 0.6 }]}
              >
                <Text
                  style={[styles.quoteLine, quotes.source === 'builtin' && styles.off]}
                  maxFontSizeMultiplier={SCALE.row}
                  numberOfLines={3}
                >
                  “{text}”
                </Text>
              </Pressable>
              <Pressable
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={`Remove quote: ${text}`}
                onPress={() => removeQuote(text)}
                style={({ pressed }) => [styles.removeBtn, pressed && { opacity: 0.6 }]}
              >
                <CloseGlyph color={palette.inkSoft} size={13} />
              </Pressable>
            </View>
          ))}
          {quotes.custom.length < MAX_CUSTOM_QUOTES ? (
            <Pressable
              onPress={() => setWriting('new')}
              style={({ pressed }) => [styles.addBtn, styles.addQuote, pressed && { opacity: 0.7 }]}
            >
              <Text style={styles.ghostText} maxFontSizeMultiplier={SCALE.heading}>
                ADD A QUOTE
              </Text>
            </Pressable>
          ) : (
            <Text style={[styles.rowSub, styles.quoteCap]} maxFontSizeMultiplier={SCALE.row}>
              {MAX_CUSTOM_QUOTES} is the most Rin keeps. Remove one to add another.
            </Text>
          )}
        </View>

        <QuoteEditor
          visible={writing !== null}
          custom={quotes.custom}
          index={typeof writing === 'number' ? writing : null}
          onCancel={() => setWriting(null)}
          onSave={(text) => {
            const index = typeof writing === 'number' ? writing : null;
            onChangeQuotes((q) => {
              const custom = placeQuote(q.custom, index, text);
              // a first quote added on built-in would never show, so it joins the rotation
              const first = q.custom.length === 0 && custom.length === 1;
              return { custom, source: first && q.source === 'builtin' ? 'both' : q.source };
            });
            setWriting(null);
          }}
        />

        <SectionHeader title="APPEARANCE" />
        <View style={styles.card}>
          <View style={styles.row}>
            <View style={styles.rowIcon}>
              <ThemeIcon mode={mode} color={palette.accent} size={18} />
            </View>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle} maxFontSizeMultiplier={SCALE.row}>
                Theme
              </Text>
              <Text style={styles.rowSub} maxFontSizeMultiplier={SCALE.row}>
                {preference === 'system'
                  ? `System: ${mode}, like this ${device()}`
                  : mode === 'dark'
                    ? 'Dark: ivory on black'
                    : 'Light: charcoal on ivory'}
              </Text>
            </View>
          </View>
          <SegmentedControl
            options={THEME_OPTIONS}
            value={preference}
            onChange={setPreference}
            verticalPadding={9}
          />
        </View>

        <Text style={styles.footer}>Your widgets follow this too.</Text>

        <View style={styles.clipPanel}>
          <ThemeBackdrop />
        </View>

        <View style={styles.colophon}>
          <Text style={styles.appName}>Rin</Text>
          <Text style={styles.appDefinition}>
            凛: dignity in showing up, day after day.
          </Text>
          <Text style={styles.madeBy}>
            Free and open-source. Made by Owais Khan. No team, no investors, and
            no analytics to tell me whether anyone ever reads this line.
          </Text>
          <Pressable
            hitSlop={10}
            accessibilityRole="link"
            onPress={() => Linking.openURL(REPO_URL)}
            style={({ pressed }) => [styles.repo, pressed && { opacity: 0.6 }]}
          >
            <Text style={styles.repoText}>{REPO_URL.replace('https://', '')}</Text>
          </Pressable>
          <Text style={styles.madeBy}>
            App is public, and staying that way. No trackers, no analytics, no
            data collection. Nothing leaves this {device()} unless you ask for a
            backup, and what leaves then is encrypted with a code I never see. An
            export goes only where you send it.
          </Text>
          <Pressable
            hitSlop={10}
            accessibilityRole="link"
            onPress={() => Linking.openURL(PRIVACY_URL)}
            style={({ pressed }) => [styles.repo, pressed && { opacity: 0.6 }]}
          >
            <Text style={styles.repoText}>Privacy policy</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

/** A setting that is either on or off; the whole row is the switch */
function ToggleRow({
  styles,
  palette,
  title,
  sub,
  on,
  onPress,
}: {
  styles: ReturnType<typeof makeStyles>;
  palette: Palette;
  title: string;
  sub: string;
  on: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: on }}
      accessibilityLabel={title}
      onPress={onPress}
      style={({ pressed }) => [styles.toggleRow, pressed && { opacity: 0.7 }]}
    >
      <View style={styles.rowText}>
        <Text style={styles.rowTitle} maxFontSizeMultiplier={SCALE.row}>
          {title}
        </Text>
        <Text style={styles.rowSub} maxFontSizeMultiplier={SCALE.row}>
          {sub}
        </Text>
      </View>
      <View style={[styles.toggle, on && styles.toggleOn]}>
        {on && <CheckGlyph color={palette.onAccent} size={13} />}
      </View>
    </Pressable>
  );
}

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
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 22,
      paddingHorizontal: 4,
      gap: 12,
    },
    title: {
      flexShrink: 1,
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
    card: {
      ...cardSurface(p),
      padding: 16,
      marginBottom: 22,
    },
    /**
     * Home for the theme clip, and the screen's slack. Taking the leftover
     * space rather than a fixed ratio puts the colophon on the bottom edge on
     * any screen without the page having to scroll to reach it — and the clip
     * is drawn with `contain`, so a wide short panel shrinks the drawing
     * instead of cropping it.
     */
    clipPanel: {
      flex: 1,
      // A floor, not a target: the panel is decoration and can give ground when
      // the screen is tight. Every point it refuses to yield is a point the page
      // overflows by, which turns the scroller back on and costs the clip its
      // blend under a drag.
      minHeight: 80,
      // Clearance for the clip's edge fades, which reach outside the panel —
      // without it they wash over the caption and the colophon. Only iOS draws
      // them, and on a short screen this margin is the difference between a
      // drawing that fills the panel and one that looks like a stamp, so
      // Android keeps its space instead of paying for a fade it never renders.
      ...Platform.select({
        ios: { marginTop: 50, marginBottom: 54 },
        default: { marginTop: 10, marginBottom: 16 },
      }),
    },
    ghostBtn: {
      marginTop: 16,
      height: 42,
      borderRadius: RADIUS.control,
      borderWidth: 1,
      borderColor: p.line,
      alignItems: 'center',
      justifyContent: 'center',
    },
    dangerText: {
      color: p.missed,
    },
    ghostText: {
      fontSize: 11,
      fontFamily: FONT.bold,
      letterSpacing: 2,
      color: p.inkSoft,
    },
    /**
     * The one ghost button that is not a way out of something. "Forget the code"
     * is quiet because it should be hard to press by accident; this is the
     * answer to the sentence directly above it, so it takes the accent the
     * alert title is already wearing and reads as part of the same paragraph.
     */
    retryText: { color: p.accent },
    emptyTitle: {
      fontSize: wrapSafe(17),
      fontFamily: FONT.semibold,
      color: p.ink,
    },
    emptyBody: {
      marginTop: 6,
      fontSize: 13,
      fontFamily: FONT.regular,
      lineHeight: wrapSafe(19),
      color: p.inkSoft,
    },
    /**
     * The states that need something done about them. Reassurance is meant to
     * sit quietly in `inkSoft` and be skimmed past; a month that has not gone
     * anywhere in three weeks says the same words at the same weight unless the
     * colour separates them, so the title takes the accent and the line under it
     * comes up to full ink.
     */
    alertTitle: { color: p.accent },
    alertBody: { color: p.ink },
    primary: {
      marginTop: 16,
      height: 44,
      borderRadius: RADIUS.control,
      backgroundColor: p.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
    primaryText: {
      fontSize: 11,
      fontFamily: FONT.bold,
      letterSpacing: 2,
      color: p.onAccent,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 14,
    },
    rowIcon: {
      width: 34,
      height: 34,
      borderRadius: RADIUS.chip,
      backgroundColor: p.accentSoft,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 12,
    },
    rowText: {
      flex: 1,
    },
    toggleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: 44,
      gap: 12,
    },
    toggle: {
      width: 22,
      height: 22,
      borderRadius: RADIUS.pill,
      borderWidth: 1.5,
      borderColor: p.line,
      alignItems: 'center',
      justifyContent: 'center',
    },
    toggleOn: {
      backgroundColor: p.accent,
      borderColor: p.accent,
    },
    slotRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: 8,
      minHeight: 44,
      paddingLeft: 12,
      paddingRight: 6,
      borderRadius: RADIUS.control,
      backgroundColor: p.chip,
    },
    slotTime: {
      flex: 1,
      alignSelf: 'stretch',
      justifyContent: 'center',
      paddingHorizontal: 12,
    },
    slotTimeText: {
      fontSize: 16,
      fontFamily: FONT.bold,
      letterSpacing: 1,
      color: p.ink,
    },
    off: {
      opacity: 0.45,
    },
    removeBtn: {
      width: 32,
      height: 32,
      alignItems: 'center',
      justifyContent: 'center',
    },
    addBtn: {
      marginTop: 8,
      marginBottom: 6,
      height: 42,
      borderRadius: RADIUS.control,
      borderWidth: 1,
      borderColor: p.line,
      alignItems: 'center',
      justifyContent: 'center',
    },
    divider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: p.line,
      marginVertical: 12,
    },
    missedRow: {
      marginTop: 8,
    },
    quoteHead: {
      marginBottom: 14,
    },
    quoteRow: {
      paddingVertical: 6,
    },
    quoteText: {
      flex: 1,
      alignSelf: 'stretch',
      justifyContent: 'center',
      paddingRight: 8,
    },
    quoteLine: {
      fontSize: 13,
      fontFamily: FONT.italic,
      lineHeight: wrapSafe(19),
      color: p.ink,
    },
    addQuote: {
      marginTop: 12,
      marginBottom: 0,
    },
    quoteCap: {
      marginTop: 12,
    },
    scopeControl: {
      marginTop: 8,
    },
    stepper: {
      paddingLeft: 6,
    },
    stepArrow: {
      fontSize: 22,
      fontFamily: FONT.medium,
      color: p.ink,
      lineHeight: 26,
    },
    stepLabel: {
      flex: 1,
      textAlign: 'center',
      fontSize: 15,
      fontFamily: FONT.semibold,
      letterSpacing: 0.5,
      color: p.ink,
    },
    exportNote: {
      marginTop: 10,
      textAlign: 'center',
    },
    chips: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
      marginTop: 6,
    },
    chip: {
      flexGrow: 1,
      alignItems: 'center',
      paddingHorizontal: 8,
      paddingVertical: 8,
      borderRadius: RADIUS.pill,
      backgroundColor: p.chip,
    },
    chipOn: {
      backgroundColor: p.accent,
    },
    chipText: {
      fontSize: 11,
      fontFamily: FONT.bold,
      letterSpacing: 1,
      color: p.inkSoft,
    },
    chipTextOn: {
      color: p.onAccent,
    },
    rowTitle: {
      fontSize: 15,
      fontFamily: FONT.semibold,
      color: p.ink,
    },
    rowSub: {
      marginTop: 1,
      fontSize: 12,
      fontFamily: FONT.regular,
      color: p.inkSoft,
    },
    colophon: {
      alignItems: 'center',
      paddingHorizontal: 12,
    },
    appName: {
      marginBottom: 4,
      fontSize: 22,
      fontFamily: FONT.bold,
      letterSpacing: 1,
      color: p.ink,
      textAlign: 'center',
    },
    appDefinition: {
      marginBottom: 14,
      fontSize: 12,
      fontFamily: FONT.italic,
      color: p.inkSoft,
      textAlign: 'center',
    },
    madeBy: {
      textAlign: 'center',
      fontSize: 11,
      lineHeight: wrapSafe(17),
      fontFamily: FONT.regular,
      color: p.inkSoft,
      opacity: 0.75,
    },
    repo: {
      marginVertical: 8,
    },
    repoText: {
      fontSize: 12,
      fontFamily: FONT.semibold,
      color: p.accent,
      textDecorationLine: 'underline',
      // the link wraps at its slashes at large text sizes
      textAlign: 'center',
    },
    footer: {
      textAlign: 'center',
      fontSize: 11,
      fontFamily: FONT.regular,
      color: p.inkSoft,
      opacity: 0.8,
    },
  });
