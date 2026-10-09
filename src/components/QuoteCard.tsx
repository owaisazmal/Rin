import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { quoteForDate } from '../quotes';
import { FONT, Palette, cardSurface, useTheme, wrapSafe } from '../theme';

/** The day's line on discipline. It changes at midnight and holds nothing of the user's. */
export default function QuoteCard({ date }: { date: Date }) {
  const { palette } = useTheme();
  const styles = useMemo(() => makeStyles(palette), [palette]);

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <View style={styles.accent} />
        <Text style={styles.label}>DISCIPLINE.</Text>
      </View>
      <Text style={styles.quote}>“{quoteForDate(date)}”</Text>
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
