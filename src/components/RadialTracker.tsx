import React, { useMemo } from 'react';
import Svg, { G, Path, Text as SvgText } from 'react-native-svg';
import { CellState, Habit, cellKey } from '../types';
import { useTheme, FONT } from '../theme';

/** Faint placeholder rings keep the dense whiteboard-grid look when few habits exist */
const MIN_RINGS = 6;

interface Props {
  size: number;
  daysInMonth: number;
  habits: Habit[];
  grid: Record<string, CellState>;
  today: number | null;
  /** days that can still be marked: today and yesterday */
  markable: readonly number[];
  selectedDay: number;
  onToggle: (day: number, habitId: string) => void;
  onSelectDay: (day: number) => void;
}

/** Angle in degrees, 0 = 12 o'clock, increasing clockwise */
function pt(cx: number, cy: number, r: number, deg: number) {
  const rad = (deg * Math.PI) / 180;
  return { x: cx + r * Math.sin(rad), y: cy - r * Math.cos(rad) };
}

function annularSectorPath(
  cx: number,
  cy: number,
  r1: number,
  r2: number,
  a1: number,
  a2: number
): string {
  const p1 = pt(cx, cy, r2, a1);
  const p2 = pt(cx, cy, r2, a2);
  const p3 = pt(cx, cy, r1, a2);
  const p4 = pt(cx, cy, r1, a1);
  const large = a2 - a1 > 180 ? 1 : 0;
  return [
    `M ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`,
    `A ${r2} ${r2} 0 ${large} 1 ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`,
    `L ${p3.x.toFixed(2)} ${p3.y.toFixed(2)}`,
    `A ${r1} ${r1} 0 ${large} 0 ${p4.x.toFixed(2)} ${p4.y.toFixed(2)}`,
    'Z',
  ].join(' ');
}

export default function RadialTracker({
  size,
  daysInMonth,
  habits,
  grid,
  today,
  markable,
  selectedDay,
  onToggle,
  onSelectDay,
}: Props) {
  const { palette } = useTheme();
  const cx = size / 2;
  const cy = size / 2;
  const labelBand = 22;
  const outerR = size / 2 - labelBand;
  const innerR = size * 0.13;
  const sector = 360 / daysInMonth;
  const gap = Math.min(1.2, sector * 0.08);
  const ringCount = Math.max(habits.length, MIN_RINGS);
  const ringWidth = (outerR - innerR) / ringCount;

  const cellFill: Record<CellState, string> = {
    0: palette.cellEmpty,
    1: palette.done,
    2: palette.missed,
  };

  const cells = useMemo(() => {
    const out: {
      d: string;
      fill: string;
      stroke: string;
      habitId: string | null;
      day: number;
      ring: number;
    }[] = [];
    for (let day = 1; day <= daysInMonth; day++) {
      const a1 = (day - 1) * sector + gap / 2;
      const a2 = day * sector - gap / 2;
      for (let ring = 0; ring < ringCount; ring++) {
        const habit = habits[ring];
        const r1 = innerR + ring * ringWidth;
        const r2 = r1 + ringWidth;
        const state: CellState = habit ? grid[cellKey(day, habit.id)] ?? 0 : 0;
        out.push({
          d: annularSectorPath(cx, cy, r1, r2 - 1, a1, a2),
          fill: cellFill[state],
          stroke: habit ? palette.line : palette.lineFaint,
          habitId: habit ? habit.id : null,
          day,
          ring,
        });
      }
    }
    return out;
    // cellFill derives from palette
  }, [daysInMonth, habits, grid, cx, cy, innerR, ringWidth, ringCount, sector, gap, palette]);

  return (
    <Svg width={size} height={size}>
      <G>
        {cells.map((c) => (
          <Path
            key={`${c.day}:${c.ring}`}
            d={c.d}
            fill={c.fill}
            stroke={c.stroke}
            strokeWidth={0.7}
            // only today's and yesterday's wedges are interactive
            onPress={
              c.habitId !== null && markable.includes(c.day)
                ? () => onToggle(c.day, c.habitId as string)
                : undefined
            }
          />
        ))}
        {Array.from({ length: daysInMonth }, (_, i) => {
          const day = i + 1;
          const mid = (day - 0.5) * sector;
          const p = pt(cx, cy, outerR + labelBand / 2 + 1, mid);
          const isToday = day === today;
          const isSelected = day === selectedDay;
          return (
            <SvgText
              key={day}
              x={p.x}
              y={p.y + 3.5}
              fontSize={isToday || isSelected ? 12 : 10}
              fontFamily={isToday || isSelected ? FONT.bold : FONT.medium}
              fill={isToday ? palette.accent : isSelected ? palette.ink : palette.inkSoft}
              textAnchor="middle"
              onPress={() => onSelectDay(day)}
            >
              {day}
            </SvgText>
          );
        })}
      </G>
    </Svg>
  );
}
