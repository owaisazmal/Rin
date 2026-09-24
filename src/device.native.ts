import { Dimensions, Platform } from 'react-native';

/** "iPad", "tablet" (600dp or more on its short side, Android's own line) or "phone" */
export function device(): string {
  if (Platform.OS === 'ios') return Platform.isPad ? 'iPad' : 'phone';
  const { width, height } = Dimensions.get('screen');
  return Math.min(width, height) >= 600 ? 'tablet' : 'phone';
}
