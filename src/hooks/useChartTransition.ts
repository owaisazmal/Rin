import { useEffect, useRef, useState } from 'react';
import { Animated, Easing } from 'react-native';
import type { ChartType } from '../settings';

/**
 * How the tracker and the month label arrive.
 *
 * Swapping chart type is a swap in place, so it cross-fades. Moving month is
 * travel, so whatever arrives comes in from the side the month came from —
 * `enterFrom` is -1 going back, +1 going forward, and 0 for a swap, which
 * collapses the slide back into a plain cross-fade. Both values are native-
 * driven and replayed from 0 whenever their key changes; the label only moves
 * when the month does, not when the chart is swapped.
 */
export function useChartTransition(chart: ChartType, monthIndex: number) {
  const chartAnim = useRef(new Animated.Value(1)).current;
  const monthAnim = useRef(new Animated.Value(1)).current;
  const [enterFrom, setEnterFrom] = useState(0);
  const prevKey = useRef({ chart, monthIndex });

  useEffect(() => {
    const moved = monthIndex - prevKey.current.monthIndex;
    const swapped = chart !== prevKey.current.chart;
    if (!moved && !swapped) return;
    prevKey.current = { chart, monthIndex };
    setEnterFrom(Math.sign(moved));

    const replay = (value: Animated.Value, duration: number) => {
      value.setValue(0);
      Animated.timing(value, {
        toValue: 1,
        duration,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    };
    replay(chartAnim, 260);
    if (moved) replay(monthAnim, 240);
  }, [chart, monthIndex, chartAnim, monthAnim]);

  return { chartAnim, monthAnim, enterFrom };
}
