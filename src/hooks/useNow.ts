import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

/** A coarse clock for countdowns; also ticks on foregrounding, since the interval is throttled meanwhile */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const tick = () => setNow(Date.now());
    const timer = setInterval(tick, intervalMs);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') tick();
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [intervalMs]);

  return now;
}
