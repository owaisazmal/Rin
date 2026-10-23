import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { QuoteList, quoteForDate, quoteHeading } from '../quotes';
import { FONT, Palette, SCALE, cardSurface, useTheme, wrapSafe } from '../theme';

/** The day's line from the active list, built-in or the user's own. It changes at midnight. */
export default function QuoteCard({ date, list }: { date: Date; list: QuoteList }) {
  const { palette } = useTheme();
  const styles = useMemo(() => makeStyles(palette), [palette]);

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <View style={styles.accent} />
        <Text style={styles.label} maxFontSizeMultiplier={SCALE.heading}>
          {quoteHeading(date, list)}
        </Text>
      </View>
      <Text style={styles.quote}>“{quoteForDate(date, list.quotes)}”</Text>
    </View>
  );
}

const makeStyles = (p: Palette) =>
  StyleSheet.create({
    card: {
      ...cardSurface(p),
      paddingVertical: 16,
      paddingHorizontal: 18,
    },
    // an inline accent bar, matching every other section — a borderLeft would
    // detach into a floating arc against the card's large corner radius
    head: {
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
    label: {
      fontSize: 12,
      fontFamily: FONT.bold,
      letterSpacing: 2,
      color: p.accent,
    },
    quote: {
      fontSize: 13,
      // the italic family carries the slant; fontStyle would be ignored here
      fontFamily: FONT.italic,
      lineHeight: wrapSafe(19),
      color: p.inkSoft,
    },
  });
