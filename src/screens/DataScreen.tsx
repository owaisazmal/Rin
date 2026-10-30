import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import BackButton from '../components/BackButton';
import SectionHeader from '../components/SectionHeader';
import SegmentedControl from '../components/SegmentedControl';
import {
  BracesGlyph,
  GridGlyph,
  ImportGlyph,
  ShareGlyph,
  UnlockGlyph,
} from '../components/Glyphs';
import type { Settings } from '../settings';
import type { QuotePrefs } from '../quotes';
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
  monthTitle,
  scopeTitle,
} from '../exportData';
import { shareExport } from '../exportFile';
import {
  ImportFile,
  ImportPlan,
  MonthChoice,
  SettingsChoice,
  applyImport,
  applySettings,
  importDoneText,
  importNotice,
  importSummary,
  monthList,
  newQuotes,
  previewImport,
  readImport,
  refusalText,
} from '../importData';
import { pickImport } from '../importFile';
import type { BackupStatus } from '../hooks/useAutoBackup';
import { backupCard, nameOf, restoreFailure } from './backupWording';
import { device } from '../device';
import type { BackupHolds, RestoreFailure } from './backupWording';
import { Palette, SCALE, useTheme } from '../theme';
import { GhostButton, PrimaryButton, Styles, ToggleRow, makeStyles } from './settingsKit';

const FORMAT_OPTIONS = [
  { value: 'json' as ExportFormat, label: 'JSON' },
  { value: 'csv' as ExportFormat, label: 'CSV' },
] as const;

const SCOPE_OPTIONS = [
  { value: 'month' as ExportScope['kind'], label: 'MONTH' },
  { value: 'year' as ExportScope['kind'], label: 'YEAR' },
  { value: 'all' as ExportScope['kind'], label: 'ALL' },
] as const;

const CLASH_OPTIONS = [
  { value: 'mine' as MonthChoice, label: 'KEEP MINE' },
  { value: 'replace' as MonthChoice, label: 'REPLACE' },
  { value: 'skip' as MonthChoice, label: 'SKIP' },
] as const;

// a damaged copy here has nothing whole to keep
const DAMAGED_OPTIONS = CLASH_OPTIONS.filter((o) => o.value !== 'mine');

export interface BackupProps {
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
  /** the phone's own quotes, so the import can count the ones it would add */
  quotes: QuotePrefs;
  /** after an import: settings to apply, and whether stored months or deadlines changed */
  onImported: (change: ((prev: Settings) => Settings) | null, reload: boolean) => void;
  onBack: () => void;
}

/** Settings' Backup & data page: the encrypted backup, and files in and out */
export default function DataScreen({ quotes, onImported, onBack, ...backup }: Props) {
  const { palette } = useTheme();
  const styles = useMemo(() => makeStyles(palette), [palette]);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} overScrollMode="never">
        <View style={[styles.pageHead, styles.header]}>
          <BackButton onPress={onBack} label="Back to settings" />
          <Text
            style={styles.pageTitle}
            accessibilityRole="header"
            maxFontSizeMultiplier={SCALE.heading}
          >
            BACKUP & DATA
          </Text>
        </View>

        <BackupSection styles={styles} {...backup} />
        <ExportSection styles={styles} palette={palette} />
        <ImportSection styles={styles} palette={palette} quotes={quotes} onImported={onImported} />
      </ScrollView>
    </SafeAreaView>
  );
}

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
  const chosenYear = years[yearAt];
  const scope = useMemo<ExportScope | null>(
    () =>
      scopeKind === 'all'
        ? { kind: 'all' }
        : scopeKind === 'month'
          ? picked
            ? { kind: 'month', year: picked.year, month: picked.month }
            : null
          : chosenYear !== undefined
            ? { kind: 'year', year: chosenYear }
            : null,
    [scopeKind, picked, chosenYear]
  );
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
  const [readAt, setReadAt] = useState(Date.now);
  useEffect(() => {
    setReadAt(Date.now());
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
  }, [scope]);
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
              {scope ? exportFileName(scope, format, readAt) : 'No months yet'}
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

function ImportSection({
  styles,
  palette,
  quotes,
  onImported,
}: {
  styles: Styles;
  palette: Palette;
  quotes: QuotePrefs;
  onImported: Props['onImported'];
}) {
  const [busy, setBusy] = useState<'reading' | 'importing' | null>(null);
  const [picked, setPicked] = useState<{ name: string | null; file: ImportFile; plan: ImportPlan } | null>(
    null
  );
  const [choices, setChoices] = useState<Record<string, MonthChoice>>({});
  const [apply, setApply] = useState<SettingsChoice>({ settings: false, quotes: false });

  /** Reads and checks the whole file before anything is shown; a refusal changes nothing */
  const choose = async () => {
    if (busy) return;
    setBusy('reading');
    try {
      const chosen = await pickImport();
      if (!chosen) return;
      const read =
        chosen.text === null
          ? ({ ok: false, refusal: { reason: 'foreign' } } as const)
          : readImport(chosen.text);
      if (!read.ok) {
        const { title, body } = refusalText(read.refusal);
        Alert.alert(title, body);
        return;
      }
      const plan = await previewImport(read.file);
      setPicked({ name: chosen.name, file: read.file, plan });
      // a month on both starts on skip, so only a tap can overwrite it
      setChoices(
        Object.fromEntries(
          plan.months.filter((m) => m.status === 'clash').map((m) => [m.key, 'skip' as const])
        )
      );
      setApply({ settings: false, quotes: false });
    } catch {
      Alert.alert('Nothing was imported', `Rin could not open the file on this ${device()}.`);
    } finally {
      setBusy(null);
    }
  };

  const run = async () => {
    if (!picked || busy) return;
    setBusy('importing');
    try {
      const result = await applyImport(picked.file, choices);
      const from = picked.file.settings;
      const chosen = { ...apply };
      setPicked(null);
      onImported(
        from && (chosen.settings || chosen.quotes)
          ? (prev) => applySettings(prev, from, chosen)
          : null,
        result.months + result.deadlines > 0
      );
      Alert.alert('Imported', importDoneText(result, chosen, device()));
    } catch {
      Alert.alert('The import did not finish', `Rin could not save everything on this ${device()}. Try again.`);
    } finally {
      setBusy(null);
    }
  };

  const notice = picked && importNotice(picked.file, picked.plan, choices, apply);
  const confirm = () => {
    if (!notice) return;
    Alert.alert(
      'Import this file?',
      notice,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Import', onPress: run },
      ],
      { cancelable: true }
    );
  };

  if (!picked) {
    return (
      <>
        <SectionHeader title="IMPORT" />
        <View style={styles.card}>
          <View style={styles.importIntro}>
            <View style={styles.rowIcon}>
              <BracesGlyph color={palette.accent} size={18} />
            </View>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle} maxFontSizeMultiplier={SCALE.row}>
                From a JSON export
              </Text>
              <Text style={styles.rowSub} maxFontSizeMultiplier={SCALE.row}>
                You see what it holds before anything changes
              </Text>
            </View>
          </View>
          <Pressable
            disabled={busy !== null}
            onPress={choose}
            accessibilityRole="button"
            style={({ pressed }) => [styles.primary, styles.shareBtn, pressed && { opacity: 0.85 }]}
          >
            <ImportGlyph color={palette.onAccent} size={15} />
            <Text style={styles.primaryText} maxFontSizeMultiplier={SCALE.heading}>
              {busy ? 'READING…' : 'CHOOSE FILE'}
            </Text>
          </Pressable>
        </View>
      </>
    );
  }

  const { file, plan } = picked;
  const summary = importSummary(file);
  const keysOf = (status: 'new' | 'same') =>
    plan.months.filter((m) => m.status === status).map((m) => m.key);
  const fresh = keysOf('new');
  const same = keysOf('same');
  const clashes = plan.months.filter((m) => m.status === 'clash');
  const { deadlines } = plan;
  const deadlineText = deadlines.blocked
    ? `Left out: this ${device()}'s deadlines can't be read in full`
    : file.deadlines.length === 0
      ? 'None in the file'
      : deadlines.add.length === 0
        ? 'All of them are already here'
        : `${deadlines.add.length} to add${deadlines.already ? ` · ${deadlines.already} already here` : ''}`;
  const quoteCount = file.settings ? newQuotes(quotes, file.settings.quotes).length : 0;

  const block = (label: string, text: string) => (
    <View style={styles.importBlock}>
      <Text style={styles.exportLabel} maxFontSizeMultiplier={SCALE.heading}>
        {label}
      </Text>
      <Text style={styles.importText} maxFontSizeMultiplier={SCALE.row}>
        {text}
      </Text>
    </View>
  );

  return (
    <>
      <SectionHeader title="IMPORT" />
      <View style={styles.card}>
        <View style={[styles.ticket, styles.importTicket]}>
          <View style={styles.rowIcon}>
            <BracesGlyph color={palette.accent} size={18} />
          </View>
          <View style={styles.rowText}>
            <Text style={styles.ticketName} maxFontSizeMultiplier={SCALE.row} numberOfLines={1}>
              {picked.name ?? 'Rin export'}
            </Text>
            <Text style={styles.rowSub} maxFontSizeMultiplier={SCALE.row}>
              {summary.line}
            </Text>
            {summary.made ? (
              <Text style={styles.rowSub} maxFontSizeMultiplier={SCALE.row}>
                {summary.made}
              </Text>
            ) : null}
            {summary.damage ? (
              <Text style={[styles.rowSub, styles.ticketDamage]} maxFontSizeMultiplier={SCALE.row}>
                {summary.damage}
              </Text>
            ) : null}
          </View>
        </View>

        {fresh.length ? block('NEW MONTHS', monthList(fresh)) : null}
        {same.length ? block('ALREADY HERE', monthList(same)) : null}
        {clashes.map((m) => {
          const choice = choices[m.key] ?? 'skip';
          return (
            <View key={m.key} style={styles.importBlock}>
              <Text style={styles.exportLabel} maxFontSizeMultiplier={SCALE.heading}>
                ON BOTH
              </Text>
              <Text style={styles.importText} maxFontSizeMultiplier={SCALE.row}>
                {monthTitle(m.key)}
              </Text>
              <Text style={styles.rowSub} maxFontSizeMultiplier={SCALE.row}>
                {m.damagedHere
                  ? `This ${device()}'s copy is damaged`
                  : choice === 'mine'
                    ? m.merged?.adds
                      ? m.merged.left
                        ? `Adds what fits; ${m.merged.left} stay out`
                        : 'Adds what only the file has'
                      : 'Yours already has everything in it'
                    : choice === 'replace'
                      ? `The file's copy replaces this ${device()}'s`
                      : 'Left as it is'}
              </Text>
              <SegmentedControl
                options={m.damagedHere ? DAMAGED_OPTIONS : CLASH_OPTIONS}
                value={choice}
                onChange={(next) => setChoices((prev) => ({ ...prev, [m.key]: next }))}
                verticalPadding={9}
                style={styles.importChoice}
              />
            </View>
          );
        })}
        {block('DEADLINES', deadlineText)}

        {file.settings ? (
          <View style={styles.importBlock}>
            <ToggleRow
              styles={styles}
              palette={palette}
              title="Settings"
              sub="Replace theme, chart, cards and reminders"
              on={apply.settings}
              onPress={() => setApply((a) => ({ ...a, settings: !a.settings }))}
            />
            {quoteCount ? (
              <ToggleRow
                styles={styles}
                palette={palette}
                title="Your quotes"
                sub={`Add ${quoteCount === 1 ? 'the 1 quote' : `${quoteCount} quotes`} you don't have yet`}
                on={apply.quotes}
                onPress={() => setApply((a) => ({ ...a, quotes: !a.quotes }))}
              />
            ) : null}
          </View>
        ) : null}

        <Pressable
          disabled={busy !== null || !notice}
          onPress={confirm}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.primary,
            styles.shareBtn,
            !notice && styles.off,
            pressed && { opacity: 0.85 },
          ]}
        >
          <ImportGlyph color={palette.onAccent} size={15} />
          <Text style={styles.primaryText} maxFontSizeMultiplier={SCALE.heading}>
            {busy ? 'IMPORTING…' : notice ? 'IMPORT' : 'NOTHING TO IMPORT'}
          </Text>
        </Pressable>
        <GhostButton
          styles={styles}
          label="CANCEL"
          disabled={busy !== null}
          onPress={() => setPicked(null)}
        />
      </View>
    </>
  );
}
