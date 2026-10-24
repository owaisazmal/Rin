import { useTheme } from '../theme';
import { Glyph } from './Glyphs';
import RoundButton from './RoundButton';

export default function BackButton({
  onPress,
  label = 'Back',
}: {
  onPress: () => void;
  label?: string;
}) {
  const { palette } = useTheme();
  return (
    <RoundButton label={label} onPress={onPress}>
      {/* nudged right of centre: a chevron's visual mass sits at its elbow */}
      <Glyph d="M14.2 5 L7.6 12 L14.2 19" color={palette.ink} size={20} weight={2} />
    </RoundButton>
  );
}
