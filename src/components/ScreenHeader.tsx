import { useMemo } from 'react';
import { StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { FONT, Palette, SCALE, useTheme } from '../theme';
import RoundButton from './RoundButton';

/** A full screen's title, with the close button opposite it */
export default function ScreenHeader({
  title,
  subtitle,
  closeLabel,
  onClose,
  style,
}: {
  title: string;
  subtitle?: string;
  closeLabel: string;
  onClose: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const { palette } = useTheme();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  return (
    <View style={[styles.header, style]}>
      <View style={styles.titleBlock}>
        <Text style={styles.title} accessibilityRole="header" maxFontSizeMultiplier={SCALE.heading}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.subtitle} maxFontSizeMultiplier={SCALE.figure}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <RoundButton label={closeLabel} onPress={onClose}>
        <Text style={styles.closeGlyph} maxFontSizeMultiplier={SCALE.glyph}>
          ✕
        </Text>
      </RoundButton>
    </View>
  );
}

const makeStyles = (p: Palette) =>
  StyleSheet.create({
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
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
    closeGlyph: {
      fontSize: 15,
      fontFamily: FONT.medium,
      color: p.ink,
      lineHeight: 18,
    },
  });
