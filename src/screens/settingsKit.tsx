import type { ReactNode } from 'react';
import {
  LayoutAnimation,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextStyle,
  View,
} from 'react-native';
import { CheckGlyph, ChevronGlyph, ExternalGlyph, Glyph } from '../components/Glyphs';
import { COLUMN, FONT, Palette, RADIUS, SCALE, cardSurface, wrapSafe } from '../theme';

/** The rows and the one style sheet that Settings and its Backup & data page share */

export type Styles = ReturnType<typeof makeStyles>;

const foldAnimation = LayoutAnimation.create(200, 'easeInEaseOut', 'opacity');

function RowHead({
  styles,
  icon,
  title,
  sub,
  attention,
  end,
}: {
  styles: Styles;
  icon: ReactNode;
  title: string;
  sub: string;
  attention?: boolean;
  end: ReactNode;
}) {
  return (
    <>
      <View style={styles.rowIcon}>{icon}</View>
      <View style={styles.rowText}>
        <Text
          style={[styles.rowTitle, attention && styles.alertTitle]}
          maxFontSizeMultiplier={SCALE.row}
        >
          {title}
        </Text>
        <Text style={styles.rowSub} maxFontSizeMultiplier={SCALE.row}>
          {sub}
        </Text>
      </View>
      <View style={styles.rowEnd}>{end}</View>
    </>
  );
}

/** A card folded to its title and a summary; tapping the head opens it */
export function Dropdown({
  styles,
  palette,
  icon,
  title,
  sub,
  attention,
  open,
  onToggle,
  children,
}: {
  styles: Styles;
  palette: Palette;
  icon: ReactNode;
  title: string;
  sub: string;
  attention?: boolean;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <View style={styles.card}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => {
          LayoutAnimation.configureNext(foldAnimation);
          onToggle();
        }}
        style={({ pressed }) => [styles.headRow, pressed && { opacity: 0.7 }]}
      >
        <RowHead
          styles={styles}
          icon={icon}
          title={title}
          sub={sub}
          attention={attention}
          end={<ChevronGlyph color={palette.inkSoft} size={16} up={open} />}
        />
      </Pressable>
      {open ? <View style={styles.foldBody}>{children}</View> : null}
    </View>
  );
}

/** A card that opens a page of its own */
export function NavRow({
  styles,
  palette,
  icon,
  title,
  sub,
  attention,
  onPress,
}: {
  styles: Styles;
  palette: Palette;
  icon: ReactNode;
  title: string;
  sub: string;
  attention?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.card, styles.headRow, pressed && { opacity: 0.7 }]}
    >
      <RowHead
        styles={styles}
        icon={icon}
        title={title}
        sub={sub}
        attention={attention}
        end={<Glyph d="M9.8 5 L16.4 12 L9.8 19" color={palette.inkSoft} size={16} />}
      />
    </Pressable>
  );
}

export function PrimaryButton({
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

export function GhostButton({
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
export function ToggleRow({
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
export function LinkRow({
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

export const makeStyles = (p: Palette) =>
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
    pageHead: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    pageTitle: {
      flexShrink: 1,
      fontSize: 26,
      fontFamily: FONT.bold,
      letterSpacing: 2,
      color: p.ink,
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
    headRow: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    rowEnd: {
      marginLeft: 10,
    },
    // the first thing inside an opened card, clear of its rule
    foldFirst: {
      marginTop: 12,
    },
    foldBody: {
      marginTop: 14,
      paddingTop: 4,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: p.line,
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
    importIntro: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    importTicket: {
      marginTop: 0,
    },
    importBlock: {
      marginTop: 14,
    },
    importText: {
      marginTop: 3,
      fontSize: 15,
      fontFamily: FONT.semibold,
      color: p.ink,
    },
    importChoice: {
      marginTop: 8,
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
