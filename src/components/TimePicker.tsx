import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { FONT, Palette, SCALE, useTheme } from '../theme';
import { Sheet, SheetActions, TimeSteppers } from './Sheet';

/** A time of day, in the same steppers the deadline sheet uses */

interface Props {
  visible: boolean;
  title: string;
  hour: number;
  minute: number;
  onCancel: () => void;
  onConfirm: (hour: number, minute: number) => void;
}

export default function TimePicker({ visible, title, hour, minute, onCancel, onConfirm }: Props) {
  const { palette } = useTheme();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const [picked, setPicked] = useState(hour * 60 + minute);

  useEffect(() => {
    if (visible) setPicked(hour * 60 + minute);
  }, [visible, hour, minute]);

  return (
    <Sheet visible={visible} onClose={onCancel}>
      <Text style={styles.title} maxFontSizeMultiplier={SCALE.heading}>
        {title}
      </Text>

      <View style={styles.timeRow}>
        <TimeSteppers minutes={picked} onChange={setPicked} />
      </View>

      <SheetActions
        onCancel={onCancel}
        confirmLabel="SET"
        onConfirm={() => onConfirm(Math.floor(picked / 60), picked % 60)}
        maxFontSizeMultiplier={SCALE.heading}
      />
    </Sheet>
  );
}

const makeStyles = (p: Palette) =>
  StyleSheet.create({
    title: {
      fontSize: 13,
      fontFamily: FONT.bold,
      letterSpacing: 2,
      color: p.ink,
    },
    timeRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 18,
      marginBottom: 22,
    },
  });
