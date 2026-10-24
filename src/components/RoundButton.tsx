import { ReactNode } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { RADIUS, useTheme } from '../theme';

/** The 44pt round, bordered control used for header actions, close and back */
export default function RoundButton({
  label,
  onPress,
  hitSlop = 10,
  children,
}: {
  label: string;
  onPress: () => void;
  hitSlop?: number;
  children: ReactNode;
}) {
  const { palette } = useTheme();
  return (
    <Pressable
      hitSlop={hitSlop}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      // no android_ripple: it would replace the background, border and all
      style={({ pressed }) => [
        styles.btn,
        { borderColor: palette.lineFaint, backgroundColor: palette.card },
        pressed && { opacity: 0.6 },
      ]}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    width: 44,
    height: 44,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
