import { useEffect, useRef, useState } from 'react';
import { Animated, Easing } from 'react-native';
import type { ChartType } from '../settings';

/** A chart swap cross-fades; a month change slides in from `enterFrom` (-1 back, +1 forward, 0 for a swap) */
export function useChartTransition(chart: ChartType, monthIndex: number) {
  const chartAnim = useRef(new Animated.Value(1)).current;
  const monthAnim = useRef(new Animated.Value(1)).current;
  // slower, for the bars, cells and line a chart draws itself in with
  const growAnim = useRef(new Animated.Value(1)).current;
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
    replay(growAnim, 760);
    if (moved) replay(monthAnim, 240);
  }, [chart, monthIndex, chartAnim, monthAnim, growAnim]);

  return { chartAnim, monthAnim, growAnim, enterFrom };
}
