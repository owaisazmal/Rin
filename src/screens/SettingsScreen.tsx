import { useEffect, useMemo, useState } from 'react';
import { Alert, AppState, Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import ScreenHeader from '../components/ScreenHeader';
import SectionHeader from '../components/SectionHeader';
import SegmentedControl from '../components/SegmentedControl';
import ThemeBackdrop from '../components/ThemeBackdrop';
import TimePicker from '../components/TimePicker';
import QuoteEditor from '../components/QuoteEditor';
import {
  BellGlyph,
  CheckGlyph,
  CloseGlyph,
  CloudGlyph,
  QuoteGlyph,
  ThemeIcon,
} from '../components/Glyphs';
import { DeadlineLead, MAX_SLOTS, NotificationPrefs, placeSlot } from '../settings';
import { DISCIPLINE_QUOTES, MAX_CUSTOM_QUOTES, QuotePrefs, QuoteSource, placeQuote } from '../quotes';
import { notificationsBlocked } from '../notifications';
import type { BackupStatus } from '../hooks/useAutoBackup';
import { backupCard } from './backupWording';
import type { BackupHolds } from './backupWording';
import { device } from '../device';
import { SCALE, ThemePreference, useTheme } from '../theme';
import { Dropdown, GhostButton, LinkRow, NavRow, ToggleRow, makeStyles } from './settingsKit';

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

function quoteSummary({ source, custom }: QuotePrefs): string {
  const builtIn = DISCIPLINE_QUOTES.length;
  if (source === 'builtin') return `The ${builtIn} that come with Rin, one a day`;
  if (custom.length === 0) return 'The built-in ones until you add your own';
  if (source === 'mine') {
    return custom.length === 1 ? 'Your one quote, every day' : `Your ${custom.length}, one a day`;
  }
  return `${builtIn} built-in and ${custom.length} of yours, one a day`;
}

/** The folded reminders card's line: when habits nudge, and how early deadlines start */
function reminderSummary(n: NotificationPrefs): string {
  const times = n.slots.filter((s) => s.on).map((s) => hhmm(s.hour, s.minute));
  const habits = n.habits && times.length ? `Habits at ${times.join(', ')}` : 'No habit reminders';
  const first = LEAD_OPTIONS.find(({ id }) => n.leads[id]);
  const deadlines = !n.deadlines
    ? 'no deadline reminders'
    : !first
      ? n.overdue
        ? 'missed deadlines only'
        : 'no deadline reminders'
      : first.id === 'due'
        ? 'deadlines when due'
        : `deadlines from ${first.spoken.toLowerCase()}`;
  return `${habits}; ${deadlines}`;
}

/** where a new reminder's picker starts */
const NEW_SLOT = { hour: 9, minute: 0 };

const hhmm = (hour: number, minute: number) =>
  `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

const REPO_URL = 'https://github.com/owaisazmal/monthly-planning';
const PRIVACY_URL = 'https://owaisazmal.github.io/Rin/privacy.html';

interface Props {
  /** enough of the backup to name its state on the row that opens Backup & data */
  hasBackup: boolean;
  lastBackupAt: number | null;
  backupStatus: BackupStatus;
  backupHolds?: BackupHolds;
  onOpenData: () => void;
  /** when reminders go out; held in App with the rest of the settings */
  notifications: NotificationPrefs;
  onChangeNotifications: (change: (prev: NotificationPrefs) => NotificationPrefs) => void;
  /** which quotes the planner's card shows, and the user's own */
  quotes: QuotePrefs;
  onChangeQuotes: (change: (prev: QuotePrefs) => QuotePrefs) => void;
  onClose: () => void;
}

type Fold = 'reminders' | 'quotes';

export default function SettingsScreen({
  notifications,
  onChangeNotifications: change,
  quotes,
  onChangeQuotes,
  onClose,
  hasBackup,
  lastBackupAt,
  backupStatus,
  backupHolds,
  onOpenData,
}: Props) {
  const { mode, preference, palette, setPreference } = useTheme();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const backup = backupCard(backupStatus, lastBackupAt, backupHolds ?? null);

  // the setting cards start folded, so the page opens short
  const [open, setOpen] = useState<Record<Fold, boolean>>({
    reminders: false,
    quotes: false,
  });
  const flip = (fold: Fold) => setOpen((o) => ({ ...o, [fold]: !o[fold] }));

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
  const silenced = blocked && anyOn;

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

        <SectionHeader title="BACKUP" />
        <NavRow
          styles={styles}
          palette={palette}
          icon={<CloudGlyph color={palette.accent} size={18} />}
          title={hasBackup ? backup.title : 'No backup'}
          sub="Encrypted backup, export and import"
          attention={hasBackup && backup.attention}
          onPress={onOpenData}
        />

        <SectionHeader title="NOTIFICATIONS" />
        <Dropdown
          styles={styles}
          palette={palette}
          icon={<BellGlyph color={palette.accent} size={18} />}
          title={silenced ? 'Notifications are off' : 'Reminders'}
          sub={silenced ? `This ${device()} isn’t letting Rin send them` : reminderSummary(notifications)}
          attention={silenced}
          open={open.reminders}
          onToggle={() => flip('reminders')}
        >
          {silenced ? (
            <>
              <Text style={[styles.emptyBody, styles.alertBody]}>
                None of the reminders below will arrive until it does.
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
        </Dropdown>

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
        <Dropdown
          styles={styles}
          palette={palette}
          icon={<QuoteGlyph color={palette.accent} size={18} />}
          title="Daily quote"
          sub={quoteSummary(quotes)}
          open={open.quotes}
          onToggle={() => flip('quotes')}
        >
          <SegmentedControl
            options={SOURCE_OPTIONS}
            value={quotes.source}
            onChange={(source) => onChangeQuotes((q) => ({ ...q, source }))}
            verticalPadding={9}
            style={styles.foldFirst}
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
        </Dropdown>

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
