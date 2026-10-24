import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  AppState,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextStyle,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import ScreenHeader from '../components/ScreenHeader';
import SectionHeader from '../components/SectionHeader';
import SegmentedControl from '../components/SegmentedControl';
import ThemeBackdrop from '../components/ThemeBackdrop';
import TimePicker from '../components/TimePicker';
import QuoteEditor from '../components/QuoteEditor';
import {
  BracesGlyph,
  CheckGlyph,
  CloseGlyph,
  ExternalGlyph,
  GridGlyph,
  ShareGlyph,
  ThemeIcon,
  UnlockGlyph,
} from '../components/Glyphs';
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
  exportSummary,
  gatherExport,
  scopeKey,
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

interface BackupProps {
  hasBackup: boolean;
  lastBackupAt: number | null;
  backupStatus: BackupStatus;
  onOpenBackup: () => void;
  /** un-park everything the last run was refused and offer it all again */
  onRetryBackup: () => Promise<void>;
  /** which documents the backup holds, or null when nothing has looked */
  backupHolds?: BackupHolds;
  /** pull one month back over this phone's damaged copy; no restore is offered without it */
  onRestoreMonth?: (key: string) => Promise<RestoreFailure | null>;
  /** erase the backup itself from the server, not just this phone's code */
  onDeleteBackup: () => Promise<{ ok: boolean; deleted: number }>;
  onForgetBackup: () => void;
}

interface Props extends BackupProps {
  /** when reminders go out; held in App with the rest of the settings */
  notifications: NotificationPrefs;
  onChangeNotifications: (change: (prev: NotificationPrefs) => NotificationPrefs) => void;
  /** which quotes the planner's card shows, and the user's own */
  quotes: QuotePrefs;
  onChangeQuotes: (change: (prev: QuotePrefs) => QuotePrefs) => void;
  onClose: () => void;
}

export default function SettingsScreen({
  notifications,
  onChangeNotifications: change,
  quotes,
  onChangeQuotes,
  onClose,
  ...backup
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

  // scrolling only when the page overflows: Android drops the clip's blend layer under a drag
  const [viewport, setViewport] = useState(0);
  const [contentHeight, setContentHeight] = useState(0);
  const scrollable = contentHeight > viewport + 1;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right', 'bottom']}>
      <ScrollView
        contentContainerStyle={styles.content}
        scrollEnabled={scrollable}
        // Android's overscroll stretch would show the clip's raw field
        overScrollMode="never"
        onLayout={(e) => setViewport(e.nativeEvent.layout.height)}
        onContentSizeChange={(_, h) => setContentHeight(h)}
      >
        <ScreenHeader
          title="SETTINGS"
          closeLabel="Close settings"
          onClose={onClose}
          style={styles.header}
        />

        <BackupSection styles={styles} {...backup} />

        <SectionHeader title="NOTIFICATIONS" />
        <View style={styles.card}>
          {blocked && anyOn ? (
            <>
              <Text style={[styles.emptyTitle, styles.alertTitle]}>Notifications are off</Text>
              <Text style={[styles.emptyBody, styles.alertBody]}>
                This {device()} isn’t letting Rin send them, so none of the reminders below will
                arrive.
              </Text>
              <GhostButton
                styles={styles}
                label="OPEN SETTINGS"
                onPress={() => Linking.openSettings()}
                tone={styles.retryText}
              />
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

        <ExportSection styles={styles} palette={palette} />

        <SectionHeader title="ABOUT" />
        <View style={styles.card}>
          <Text style={styles.appName} maxFontSizeMultiplier={SCALE.heading}>
            Rin
          </Text>
          <Text style={styles.appDefinition}>凛: dignity in showing up, day after day.</Text>
          <Text style={styles.madeBy}>
            Free and open-source. Made by Owais Khan. No team, no investors, and
            no analytics to tell me whether anyone ever reads this line.
          </Text>
          <View style={styles.divider} />
          <LinkRow
            styles={styles}
            palette={palette}
            title="Source code"
            sub={REPO_URL.replace('https://', '')}
            url={REPO_URL}
          />
          <LinkRow
            styles={styles}
            palette={palette}
            title="Privacy policy"
            sub={PRIVACY_URL.replace('https://', '').replace('/privacy.html', '')}
            url={PRIVACY_URL}
          />
          <View style={styles.divider} />
          <Text style={styles.madeBy}>
            App is public, and staying that way. No trackers, no analytics, no
            data collection. Nothing leaves this {device()} unless you ask for a
            backup, and what leaves then is encrypted with a code I never see. An
            export goes only where you send it.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

type Styles = ReturnType<typeof makeStyles>;

/** The backup card's sentences come from backupWording.ts, where tests can read them */
function BackupSection({
  styles,
  hasBackup,
  lastBackupAt,
  backupStatus,
  onOpenBackup,
  onRetryBackup,
  backupHolds,
  onRestoreMonth,
  onDeleteBackup,
  onForgetBackup,
}: BackupProps & { styles: Styles }) {
  // the card hears what the backup holds only when there is a restore button to offer
  const card = backupCard(backupStatus, lastBackupAt, onRestoreMonth ? backupHolds ?? null : null);
  const damagedMonth = card.restore;

  // nothing reported on the way out: the card redraws itself from the ledger
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
              // only a failure is announced; success redraws the card
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

  const [deleting, setDeleting] = useState(false);
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

  return (
    <>
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
            <PrimaryButton styles={styles} label="BACK UP NOW" onPress={onOpenBackup} />
            {damagedMonth !== null ? (
              <GhostButton
                styles={styles}
                label={restoring ? 'RESTORING…' : 'RESTORE THIS MONTH'}
                onPress={() => restore(damagedMonth)}
                tone={styles.retryText}
                disabled={restoring}
              />
            ) : null}
            {card.retry ? (
              <GhostButton
                styles={styles}
                label={retrying ? 'TRYING…' : 'TRY IT AGAIN NOW'}
                onPress={retry}
                tone={styles.retryText}
                disabled={retrying}
              />
            ) : null}
            <GhostButton styles={styles} label="FORGET THE CODE" onPress={confirmForget} />
            <GhostButton
              styles={styles}
              label={deleting ? 'DELETING…' : 'DELETE THE BACKUP'}
              onPress={confirmDelete}
              tone={styles.dangerText}
              disabled={deleting}
            />
          </>
        ) : (
          <>
            <Text style={styles.emptyTitle}>No backup</Text>
            <Text style={styles.emptyBody}>
              Everything works without one. A backup carries your months to your
              next {device()}, encrypted with a code only you hold.
            </Text>
            <PrimaryButton styles={styles} label="SET ONE UP" onPress={onOpenBackup} />
          </>
        )}
      </View>
    </>
  );
}

function ExportSection({ styles, palette }: { styles: Styles; palette: Palette }) {
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
  const stepArrow = (delta: -1 | 1) => {
    const end = delta < 0 ? stepAt <= 0 : stepAt >= stepCount - 1;
    return (
      <Pressable
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel={`${delta < 0 ? 'Earlier' : 'Later'} ${scopeKind === 'month' ? 'month' : 'year'}`}
        disabled={end}
        onPress={() => step(delta)}
        style={({ pressed }) => [styles.removeBtn, end && styles.off, pressed && { opacity: 0.6 }]}
      >
        <Text style={styles.stepArrow} maxFontSizeMultiplier={SCALE.glyph}>
          {delta < 0 ? '‹' : '›'}
        </Text>
      </Pressable>
    );
  };

  // what the file will hold, read again whenever the range changes
  const [preview, setPreview] = useState<ExportFile | null>(null);
  const scopeId = scope ? scopeKey(scope) : null;
  useEffect(() => {
    if (!scope) {
      setPreview(null);
      return;
    }
    let live = true;
    gatherExport(scope).then(
      (file) => live && setPreview(file),
      () => live && setPreview(null)
    );
    return () => {
      live = false;
    };
  }, [scopeId]);
  const summary = preview ? exportSummary(preview, format) : null;

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

  return (
    <>
      <SectionHeader title="EXPORT" />
      <View style={styles.card}>
        <View style={styles.exportRow}>
          <View style={styles.exportLabelBox}>
            <Text style={styles.exportLabel} maxFontSizeMultiplier={SCALE.heading}>
              FORMAT
            </Text>
          </View>
          <SegmentedControl
            options={FORMAT_OPTIONS}
            value={format}
            onChange={setFormat}
            verticalPadding={9}
            style={styles.exportControl}
          />
        </View>
        <View style={[styles.exportRow, styles.exportGap]}>
          <View style={styles.exportLabelBox}>
            <Text style={styles.exportLabel} maxFontSizeMultiplier={SCALE.heading}>
              RANGE
            </Text>
          </View>
          <View style={styles.exportControl}>
            <SegmentedControl
              options={SCOPE_OPTIONS}
              value={scopeKind}
              onChange={setScopeKind}
              verticalPadding={9}
            />
            {scopeKind !== 'all' ? (
              <View style={[styles.slotRow, styles.stepper]}>
                {stepArrow(-1)}
                <Text style={styles.stepLabel} maxFontSizeMultiplier={SCALE.row}>
                  {scope ? scopeTitle(scope) : 'No months yet'}
                </Text>
                {stepArrow(1)}
              </View>
            ) : null}
          </View>
        </View>

        <View style={styles.ticket}>
          <View style={styles.rowIcon}>
            {format === 'json' ? (
              <BracesGlyph color={palette.accent} size={18} />
            ) : (
              <GridGlyph color={palette.accent} size={18} />
            )}
          </View>
          <View style={styles.rowText}>
            <Text style={styles.ticketName} maxFontSizeMultiplier={SCALE.row} numberOfLines={1}>
              {scope ? exportFileName(scope, format, Date.now()) : 'No months yet'}
            </Text>
            {(summary?.lines ?? (scope ? ['Reading…'] : [])).map((line) => (
              <Text key={line} style={styles.rowSub} maxFontSizeMultiplier={SCALE.row}>
                {line}
              </Text>
            ))}
            {summary?.damage ? (
              <Text
                style={[styles.rowSub, styles.ticketDamage]}
                maxFontSizeMultiplier={SCALE.row}
              >
                {summary.damage}
              </Text>
            ) : null}
          </View>
        </View>

        <View style={styles.warnStrip}>
          <UnlockGlyph color={palette.accent} size={16} />
          <Text style={styles.warnText} maxFontSizeMultiplier={SCALE.row}>
            Not encrypted. Rin uploads nothing; the file goes only where you send it.
          </Text>
        </View>

        <Pressable
          disabled={exporting || !scope}
          onPress={startExport}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.primary,
            styles.shareBtn,
            !scope && styles.off,
            pressed && { opacity: 0.85 },
          ]}
        >
          <ShareGlyph color={palette.onAccent} size={15} />
          <Text style={styles.primaryText} maxFontSizeMultiplier={SCALE.heading}>
            {exporting ? 'READING…' : 'SHARE FILE'}
          </Text>
        </Pressable>
      </View>
    </>
  );
}

function PrimaryButton({
  styles,
  label,
  onPress,
}: {
  styles: Styles;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.primary, pressed && { opacity: 0.85 }]}
    >
      <Text style={styles.primaryText} maxFontSizeMultiplier={SCALE.heading}>
        {label}
      </Text>
    </Pressable>
  );
}

function GhostButton({
  styles,
  label,
  onPress,
  tone,
  disabled,
}: {
  styles: Styles;
  label: string;
  onPress: () => void;
  tone?: TextStyle;
  disabled?: boolean;
}) {
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.ghostBtn, pressed && { opacity: 0.7 }]}
    >
      <Text style={[styles.ghostText, tone]} maxFontSizeMultiplier={SCALE.heading}>
        {label}
      </Text>
    </Pressable>
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
  styles: Styles;
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

/** A link out of the app, with where it goes underneath */
function LinkRow({
  styles,
  palette,
  title,
  sub,
  url,
}: {
  styles: Styles;
  palette: Palette;
  title: string;
  sub: string;
  url: string;
}) {
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={title}
      onPress={() => Linking.openURL(url)}
      style={({ pressed }) => [styles.toggleRow, pressed && { opacity: 0.6 }]}
    >
      <View style={styles.rowText}>
        <Text style={styles.rowTitle} maxFontSizeMultiplier={SCALE.row}>
          {title}
        </Text>
        <Text style={styles.rowSub} maxFontSizeMultiplier={SCALE.row} numberOfLines={1}>
          {sub}
        </Text>
      </View>
      <ExternalGlyph color={palette.inkSoft} size={14} />
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
      marginBottom: 22,
    },
    card: {
      ...cardSurface(p),
      padding: 16,
      marginBottom: 22,
    },
    // the theme clip takes the page's leftover space, so the page fits without scrolling
    clipPanel: {
      flex: 1,
      minHeight: 80,
      // room for the edge fades only iOS draws outside the panel
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
    // states that need acting on stand out from the reassurance
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
    exportRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 10,
    },
    exportGap: {
      marginTop: 10,
    },
    // as tall as the control beside it, so the label sits on its middle
    exportLabelBox: {
      minWidth: 64,
      minHeight: 37,
      justifyContent: 'center',
    },
    exportLabel: {
      fontSize: 10,
      fontFamily: FONT.bold,
      letterSpacing: 2,
      color: p.inkSoft,
    },
    exportControl: {
      flex: 1,
    },
    stepper: {
      paddingLeft: 6,
      minHeight: 40,
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
    ticket: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: 16,
      padding: 12,
      borderRadius: RADIUS.control,
      borderWidth: 1.5,
      borderStyle: 'dashed',
      borderColor: p.line,
    },
    ticketName: {
      fontSize: 15,
      fontFamily: FONT.semibold,
      color: p.ink,
      marginBottom: 2,
    },
    ticketDamage: {
      color: p.accent,
    },
    warnStrip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      marginTop: 12,
      paddingVertical: 10,
      paddingHorizontal: 12,
      borderRadius: RADIUS.control,
      backgroundColor: p.accentSoft,
    },
    warnText: {
      flex: 1,
      fontSize: 12,
      lineHeight: wrapSafe(17),
      fontFamily: FONT.regular,
      color: p.ink,
    },
    shareBtn: {
      flexDirection: 'row',
      gap: 8,
      marginTop: 12,
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
    appName: {
      marginBottom: 2,
      fontSize: 22,
      fontFamily: FONT.bold,
      letterSpacing: 1,
      color: p.ink,
    },
    appDefinition: {
      marginBottom: 10,
      fontSize: 13,
      fontFamily: FONT.italic,
      color: p.inkSoft,
    },
    madeBy: {
      fontSize: 12,
      lineHeight: wrapSafe(18),
      fontFamily: FONT.regular,
      color: p.inkSoft,
    },
    footer: {
      textAlign: 'center',
      fontSize: 11,
      fontFamily: FONT.regular,
      color: p.inkSoft,
      opacity: 0.8,
    },
  });
