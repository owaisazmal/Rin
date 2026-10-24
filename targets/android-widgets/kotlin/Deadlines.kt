package com.owaiskhan.monthlyplanning.widgets

import androidx.compose.runtime.Composable
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.GlanceModifier
import androidx.glance.appwidget.cornerRadius
import androidx.glance.background
import androidx.glance.layout.Alignment
import androidx.glance.layout.Box
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.layout.width
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import kotlin.math.roundToInt

// Mirrors src/deadlines.ts and the Swift Deadline enum; the bands must match across all three.
object Deadline {
  const val HOUR = 3_600_000L
  const val DAY = 86_400_000L

  /** the run-up over which a deadline goes from "someday" to "now" */
  const val PRESSURE_WINDOW = 7 * DAY

  /** 0 a week or more out, 1 at the deadline and past it */
  fun pressure(due: Long, now: Long): Float {
    val left = due - now
    return when {
      left <= 0 -> 1f
      left >= PRESSURE_WINDOW -> 0f
      else -> 1f - left.toFloat() / PRESSURE_WINDOW
    }
  }

  /** The colour band, drawn from the same palette the rest of the app uses */
  fun colour(due: Long, now: Long, theme: WidgetTheme): Int {
    val left = due - now
    return when {
      left <= HOUR -> theme.missed
      left <= 3 * DAY -> theme.accent
      else -> theme.inkSoft
    }
  }

  /** Largest unit only — "3d", "5h", "12m" */
  private fun coarse(ms: Long): String = when {
    ms >= DAY -> "${ms / DAY}d"
    ms >= HOUR -> "${ms / HOUR}h"
    ms >= 60_000L -> "${ms / 60_000L}m"
    else -> "now"
  }

  fun timeLeft(due: Long, now: Long): String {
    val left = due - now
    if (left <= 0) {
      val over = coarse(-left)
      return if (over == "now") "just overdue" else "$over overdue"
    }
    val rem = coarse(left)
    return if (rem == "now") "due any moment" else "$rem left"
  }

  /** The date line, with the series named on a recurring deadline */
  fun dueLine(task: DeadlineTask, now: Long): String =
    dueLabel(task.due, now) + (task.repeats?.let { " · $it" } ?: "")

  fun dueLabel(due: Long, now: Long): String {
    val time = SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date(due))
    val startOfDay = { ms: Long ->
      Calendar.getInstance().apply {
        timeInMillis = ms
        set(Calendar.HOUR_OF_DAY, 0)
        set(Calendar.MINUTE, 0)
        set(Calendar.SECOND, 0)
        set(Calendar.MILLISECOND, 0)
      }.timeInMillis
    }
    // rounded: a 23-hour DST day would otherwise call tomorrow "Today"
    val days = ((startOfDay(due) - startOfDay(now)).toDouble() / DAY).roundToInt()
    return when (days) {
      0 -> "Today · $time"
      1 -> "Tomorrow · $time"
      -1 -> "Yesterday · $time"
      else -> "${SimpleDateFormat("EEE d MMM", Locale.getDefault()).format(Date(due))} · $time"
    }
  }
}

/** Heading plus the gap under it, in dp */
private const val HEADER_HEIGHT = 24f

/** Fills over the last week; Glance can't size by fraction, so the width is in dp. */
@Composable
private fun PressureBar(fraction: Float, tone: Int, theme: WidgetTheme, availW: Float) {
  val filled = (availW * fraction.coerceIn(0f, 1f)).coerceAtLeast(2f)
  Box(
    modifier = GlanceModifier
      .fillMaxWidth()
      .height(3.dp)
      .background(theme.provider(theme.cellEmpty))
      .cornerRadius(2.dp)
  ) {
    Box(
      modifier = GlanceModifier
        .width(filled.dp)
        .height(3.dp)
        .background(theme.provider(tone))
        .cornerRadius(2.dp)
    ) {}
  }
}

class DeadlinesWidget : PlannerWidget({ DeadlinesContent() })
class DeadlinesReceiver : PlannerReceiver(DeadlinesWidget())

@Composable
private fun WidgetScope.DeadlinesContent() {
  val now = System.currentTimeMillis()
  val tasks = snap.tasks

  // must match a row's real height (title, date line, bar, gap) or the last one is clipped
  val showDates = availH >= 110f
  val rowHeight = if (showDates) 47f else 34f
  val limit = ((availH - HEADER_HEIGHT) / rowHeight).toInt().coerceIn(1, 6)

  Column(modifier = GlanceModifier.fillMaxSize()) {
    Heading("DEADLINES", theme, if (tasks.isEmpty()) null else "${tasks.size}")
    Spacer(GlanceModifier.height(6.dp))

    if (tasks.isEmpty()) {
      Text(
        "Nothing due. Add a deadline in the app.",
        style = TextStyle(color = theme.provider(theme.inkSoft), fontSize = 11.sp),
      )
    } else {
      tasks.take(limit).forEach { task ->
        val tone = Deadline.colour(task.due, now, theme)
        Column(modifier = GlanceModifier.fillMaxWidth().padding(bottom = 8.dp)) {
          Row(
            modifier = GlanceModifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
          ) {
            // weighted, so a long title is cut short instead of the time left
            Row(modifier = GlanceModifier.defaultWeight(), verticalAlignment = Alignment.CenterVertically) {
              Text(
                text = task.text.ifEmpty { "Untitled task" },
                maxLines = 1,
                style = TextStyle(
                  color = theme.provider(theme.ink),
                  fontSize = 13.sp,
                  fontWeight = FontWeight.Medium,
                ),
              )
              // without the date line, a mark after the title is all that says it repeats
              if (task.repeats != null && !showDates) {
                Text(
                  text = " ↻",
                  maxLines = 1,
                  style = TextStyle(color = theme.provider(theme.inkSoft), fontSize = 11.sp),
                )
              }
            }
            Spacer(GlanceModifier.width(6.dp))
            Text(
              text = Deadline.timeLeft(task.due, now),
              maxLines = 1,
              style = TextStyle(
                color = theme.provider(tone),
                fontSize = 11.sp,
                fontWeight = FontWeight.Bold,
              ),
            )
          }
          if (showDates) {
            Text(
              text = Deadline.dueLine(task, now),
              maxLines = 1,
              style = TextStyle(color = theme.provider(theme.inkSoft), fontSize = 10.sp),
            )
          }
          Spacer(GlanceModifier.height(4.dp))
          PressureBar(Deadline.pressure(task.due, now), tone, theme, availW)
        }
      }
      if (tasks.size > limit) {
        Text(
          "+${tasks.size - limit} more",
          style = TextStyle(color = theme.provider(theme.inkSoft), fontSize = 10.sp),
        )
      }
    }
    Spacer(GlanceModifier.defaultWeight())
  }
}
