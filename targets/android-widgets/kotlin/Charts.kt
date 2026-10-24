package com.owaiskhan.monthlyplanning.widgets

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import java.util.Calendar
import kotlin.math.ceil
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.sin

// Glance has no canvas, so charts are drawn to bitmaps; geometry matches targets/widgets/Charts.swift.

private fun fillPaint(color: Int) = Paint(Paint.ANTI_ALIAS_FLAG).apply {
  this.color = color
  style = Paint.Style.FILL
}

/** A wedge of an annulus, shifted -90° so day 1 sits at the top as in RadialTracker.tsx. */
private fun annularSector(
  cx: Float, cy: Float, r1: Float, r2: Float, startDeg: Float, sweepDeg: Float,
): Path {
  val path = Path()
  val outer = RectF(cx - r2, cy - r2, cx + r2, cy + r2)
  val inner = RectF(cx - r1, cy - r1, cx + r1, cy + r1)
  path.arcTo(outer, startDeg - 90f, sweepDeg)
  path.arcTo(inner, startDeg - 90f + sweepDeg, -sweepDeg)
  path.close()
  return path
}

/** The month as rings: one ring per habit, one wedge per day. */
fun drawRadialChart(
  snapshot: PlannerSnapshot,
  theme: WidgetTheme,
  sizePx: Int,
  minRings: Int = 4,
): Bitmap {
  val bitmap = Bitmap.createBitmap(sizePx, sizePx, Bitmap.Config.ARGB_8888)
  val canvas = Canvas(bitmap)
  val cx = sizePx / 2f
  val cy = sizePx / 2f
  val markerRoom = sizePx * 0.045f
  val outer = sizePx / 2f - markerRoom
  val inner = sizePx * 0.17f
  val rings = maxOf(snapshot.habits.size, minRings)
  val ringWidth = (outer - inner) / rings
  val days = maxOf(snapshot.daysInMonth, 1)
  val sector = 360f / days
  val gap = min(1.4f, sector * 0.09f)

  for (dayIndex in 0 until days) {
    val start = dayIndex * sector + gap / 2f
    val sweep = sector - gap
    for (ring in 0 until rings) {
      val r1 = inner + ring * ringWidth
      val r2 = r1 + ringWidth - maxOf(0.6f, ringWidth * 0.12f)
      val state = if (ring < snapshot.habits.size) {
        snapshot.state(dayIndex + 1, ring)
      } else 0
      canvas.drawPath(
        annularSector(cx, cy, r1, r2, start, sweep),
        fillPaint(theme.stateColor(state)),
      )
    }
  }

  // a dot outside the rings rather than a wedge across them
  val today = snapshot.today
  if (today != null && today <= days) {
    val mid = ((today - 0.5f) * sector - 90f) * Math.PI.toFloat() / 180f
    val radius = outer + markerRoom * 0.6f
    canvas.drawCircle(
      cx + radius * cos(mid),
      cy + radius * sin(mid),
      sizePx * 0.012f,
      fillPaint(theme.accent),
    )
  }
  return bitmap
}

/** GitHub-style grid: columns are weeks, rows are Sun–Sat. */
fun drawYearGrid(
  snapshot: PlannerSnapshot,
  theme: WidgetTheme,
  widthPx: Int,
  cellPx: Float,
  gapPx: Float,
  weekLimit: Int,
): Bitmap {
  val step = cellPx + gapPx
  val height = (7 * step - gapPx).toInt().coerceAtLeast(1)
  val bitmap = Bitmap.createBitmap(widthPx.coerceAtLeast(1), height, Bitmap.Config.ARGB_8888)
  val canvas = Canvas(bitmap)

  val calendar = Calendar.getInstance().apply {
    clear(); set(snapshot.year, 0, 1)
  }
  val startOffset = calendar.get(Calendar.DAY_OF_WEEK) - 1

  data class Day(val month: Int, val day: Int)
  val days = mutableListOf<Day>()
  for (m in 0 until 12) {
    val len = snapshot.yearDone.getOrNull(m)?.size ?: 0
    for (d in 1..len) days.add(Day(m, d))
  }
  if (days.isEmpty()) return bitmap

  val totalCols = ceil((startOffset + days.size) / 7.0).toInt()
  // the window ends at today, not December, or it would mostly show empty future weeks
  val todayIndex = snapshot.today?.let { today ->
    var idx = 0
    for (m in 0 until snapshot.month) idx += snapshot.yearDone.getOrNull(m)?.size ?: 0
    idx + today - 1
  }
  val lastCol = todayIndex?.let { (it + startOffset) / 7 } ?: (totalCols - 1)
  val firstCol = maxOf(0, lastCol - weekLimit + 1)

  fun levelColor(day: Day): Int {
    val done = snapshot.yearDone.getOrNull(day.month)?.getOrNull(day.day - 1) ?: 0
    val missed = snapshot.yearMissed.getOrNull(day.month)?.getOrNull(day.day - 1) ?: 0
    val habitCount = snapshot.yearHabitCounts.getOrNull(day.month) ?: 0
    if (done > 0 && habitCount > 0) {
      val ratio = done.toDouble() / habitCount
      val idx = when {
        ratio <= 0.25 -> 1
        ratio <= 0.5 -> 2
        ratio <= 0.75 -> 3
        else -> 4
      }
      return theme.ghLevels[idx]
    }
    if (missed > 0) return theme.missed
    return theme.ghLevels[0]
  }

  for (col in firstCol..lastCol) {
    for (row in 0 until 7) {
      val idx = col * 7 + row - startOffset
      if (idx < 0 || idx >= days.size) continue
      val left = (col - firstCol) * step
      val top = row * step
      if (left > widthPx) continue
      canvas.drawRoundRect(
        RectF(left, top, left + cellPx, top + cellPx),
        cellPx * 0.22f, cellPx * 0.22f,
        fillPaint(levelColor(days[idx])),
      )
    }
  }
  return bitmap
}

/** Ring showing a 0–1 fraction, matching the SwiftUI ProgressRing. */
fun drawProgressRing(
  fraction: Float,
  theme: WidgetTheme,
  sizePx: Int,
  strokePx: Float,
): Bitmap {
  val bitmap = Bitmap.createBitmap(sizePx, sizePx, Bitmap.Config.ARGB_8888)
  val canvas = Canvas(bitmap)
  val inset = strokePx / 2f
  val rect = RectF(inset, inset, sizePx - inset, sizePx - inset)

  val track = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = theme.cellEmpty
    style = Paint.Style.STROKE
    strokeWidth = strokePx
  }
  canvas.drawArc(rect, 0f, 360f, false, track)

  val progress = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = theme.done
    style = Paint.Style.STROKE
    strokeWidth = strokePx
    strokeCap = Paint.Cap.ROUND
  }
  canvas.drawArc(rect, -90f, 360f * fraction.coerceIn(0.001f, 1f), false, progress)
  return bitmap
}

/** Horizontal progress bar, drawn so its ends stay round on every API level. */
fun drawProgressBar(
  fraction: Float,
  theme: WidgetTheme,
  widthPx: Int,
  heightPx: Int,
): Bitmap {
  val w = widthPx.coerceAtLeast(1)
  val h = heightPx.coerceAtLeast(1)
  val bitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
  val canvas = Canvas(bitmap)
  val radius = h / 2f
  canvas.drawRoundRect(RectF(0f, 0f, w.toFloat(), h.toFloat()), radius, radius, fillPaint(theme.cellEmpty))
  val filled = (w * fraction.coerceIn(0f, 1f)).coerceAtLeast(h.toFloat())
  canvas.drawRoundRect(RectF(0f, 0f, filled, h.toFloat()), radius, radius, fillPaint(theme.accent))
  return bitmap
}

/** Seven-day run of pips for the streak widget. */
fun drawPips(
  snapshot: PlannerSnapshot,
  theme: WidgetTheme,
  cellPx: Float,
  gapPx: Float,
): Bitmap? {
  val today = snapshot.today ?: return null
  val first = maxOf(1, today - 6)
  val dayRange = (first..today).toList()
  val width = (dayRange.size * (cellPx + gapPx) - gapPx).toInt().coerceAtLeast(1)
  val bitmap = Bitmap.createBitmap(width, cellPx.toInt().coerceAtLeast(1), Bitmap.Config.ARGB_8888)
  val canvas = Canvas(bitmap)
  dayRange.forEachIndexed { i, day ->
    val left = i * (cellPx + gapPx)
    canvas.drawRoundRect(
      RectF(left, 0f, left + cellPx, cellPx),
      cellPx * 0.25f, cellPx * 0.25f,
      fillPaint(if (snapshot.doneCount(day) > 0) theme.done else theme.cellEmpty),
    )
  }
  return bitmap
}
