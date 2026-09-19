package com.owaiskhan.monthlyplanning.widgets

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.Image
import androidx.glance.ImageProvider
import androidx.glance.LocalContext
import androidx.glance.LocalSize
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.SizeMode
import androidx.glance.appwidget.cornerRadius
import androidx.glance.appwidget.provideContent
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
import androidx.glance.layout.size
import androidx.glance.layout.width
import androidx.glance.text.FontStyle
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import java.util.Calendar

/**
 * Android widgets, the counterpart of the Swift widgets in targets/widgets.
 * (Careful with paths in block comments here: Kotlin nests them, so a literal
 * slash-star inside one opens a second comment and swallows the closer.)
 *
 * Android widgets are freely resizable, so there is no small/medium/large to
 * design against. Every widget uses SizeMode.Exact and derives its chart and row
 * dimensions from the real size it was handed — with Responsive, LocalSize
 * reports the nearest declared breakpoint instead, which left charts at a fixed
 * size and most of each card empty.
 */

private const val PAD = 12f

private fun Context.px(dp: Float): Int = (dp * resources.displayMetrics.density).toInt()

private fun snapshotOf(context: Context) =
  PlannerSnapshot.load(context) ?: PlannerSnapshot.placeholder

@Composable
private fun WidgetScaffold(theme: WidgetTheme, content: @Composable () -> Unit) {
  Box(
    modifier = GlanceModifier
      .fillMaxSize()
      .background(theme.provider(theme.bg))
      .cornerRadius(20.dp)
      .padding(PAD.dp)
  ) { content() }
}

@Composable
private fun Heading(text: String, theme: WidgetTheme, trailing: String? = null) {
  Row(modifier = GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
    Box(
      modifier = GlanceModifier
        .width(3.dp).height(11.dp)
        .background(theme.provider(theme.accent))
        .cornerRadius(2.dp)
    ) {}
    Spacer(GlanceModifier.width(6.dp))
    Text(
      text = text,
      style = TextStyle(color = theme.provider(theme.ink), fontSize = 10.sp, fontWeight = FontWeight.Bold),
    )
    Spacer(GlanceModifier.defaultWeight())
    if (trailing != null) {
      Text(text = trailing, style = TextStyle(color = theme.provider(theme.inkSoft), fontSize = 10.sp))
    }
  }
}

@Composable
private fun Stat(value: String, label: String, theme: WidgetTheme, size: Int = 15) {
  Row(verticalAlignment = Alignment.CenterVertically) {
    Text(
      text = value,
      style = TextStyle(color = theme.provider(theme.ink), fontSize = size.sp, fontWeight = FontWeight.Bold),
    )
    Spacer(GlanceModifier.width(4.dp))
    Text(text = label, style = TextStyle(color = theme.provider(theme.inkSoft), fontSize = 11.sp))
  }
}

/** Footer used wherever a list leaves room underneath, so cards don't end in a void. */
@Composable
private fun StatFooter(snap: PlannerSnapshot, theme: WidgetTheme) {
  Row(modifier = GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
    Stat("${snap.monthPct}%", "month", theme, size = 13)
    Spacer(GlanceModifier.defaultWeight())
    Text(
      "${snap.currentStreak}d streak",
      style = TextStyle(color = theme.provider(theme.accent), fontSize = 11.sp, fontWeight = FontWeight.Bold),
    )
  }
}

// MARK: Radial tracker

class RadialWidget : GlanceAppWidget() {
  override val sizeMode = SizeMode.Exact
  override suspend fun provideGlance(context: Context, id: GlanceId) =
    provideContent { RadialContent() }
}

@Composable
private fun RadialContent() {
  val context = LocalContext.current
  val snap = snapshotOf(context)
  val theme = WidgetTheme.of(context, snap)
  val size = LocalSize.current
  val availW = size.width.value - PAD * 2
  val availH = size.height.value - PAD * 2
  val wide = size.width.value > size.height.value * 1.4f

  WidgetScaffold(theme) {
    if (!wide) {
      // fill the card: chart takes everything the caption doesn't need
      val chart = minOf(availW, availH - 20f).coerceAtLeast(48f)
      Column(
        modifier = GlanceModifier.fillMaxSize(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalAlignment = Alignment.CenterVertically,
      ) {
        Image(
          provider = ImageProvider(drawRadialChart(snap, theme, context.px(chart))),
          contentDescription = "Month tracker",
          modifier = GlanceModifier.size(chart.dp),
        )
        Spacer(GlanceModifier.height(4.dp))
        Text(
          "${snap.monthDone}/${snap.monthTotal}",
          style = TextStyle(color = theme.provider(theme.inkSoft), fontSize = 11.sp),
        )
      }
    } else {
      val chart = availH.coerceAtLeast(56f)
      Row(modifier = GlanceModifier.fillMaxSize(), verticalAlignment = Alignment.CenterVertically) {
        Image(
          provider = ImageProvider(drawRadialChart(snap, theme, context.px(chart), minRings = 6)),
          contentDescription = "Month tracker",
          modifier = GlanceModifier.size(chart.dp),
        )
        Spacer(GlanceModifier.width(12.dp))
        Column(modifier = GlanceModifier.defaultWeight()) {
          Heading(snap.monthName, theme, "${snap.year}")
          Spacer(GlanceModifier.defaultWeight())
          Stat("${snap.monthPct}%", "of the month done", theme)
          Stat("${snap.currentStreak}", "day streak", theme)
          Stat("${snap.habits.size}", "habits tracked", theme)
          Spacer(GlanceModifier.defaultWeight())
        }
      }
    }
  }
}

class RadialReceiver : GlanceAppWidgetReceiver() {
  override val glanceAppWidget: GlanceAppWidget = RadialWidget()
}

// MARK: Year tracker

class YearWidget : GlanceAppWidget() {
  override val sizeMode = SizeMode.Exact
  override suspend fun provideGlance(context: Context, id: GlanceId) =
    provideContent { YearContent() }
}

@Composable
private fun YearContent() {
  val context = LocalContext.current
  val snap = snapshotOf(context)
  val theme = WidgetTheme.of(context, snap)
  val size = LocalSize.current
  val availW = size.width.value - PAD * 2
  val availH = size.height.value - PAD * 2

  // grid takes whatever the header and footer leave, and the cell size follows
  // from that rather than being fixed — otherwise it floats in a mostly empty card
  val gridH = (availH - 34f).coerceAtLeast(28f)
  val gap = 2f
  val cell = ((gridH - gap * 6f) / 7f).coerceIn(3f, 16f)
  val weeks = ((availW + gap) / (cell + gap)).toInt().coerceIn(4, 53)

  WidgetScaffold(theme) {
    Column(modifier = GlanceModifier.fillMaxSize()) {
      Heading("${snap.year}", theme, "${snap.yearTotal} check-ins")
      Spacer(GlanceModifier.defaultWeight())
      Image(
        provider = ImageProvider(
          drawYearGrid(snap, theme, context.px(availW), context.px(cell).toFloat(), context.px(gap).toFloat(), weekLimit = weeks)
        ),
        contentDescription = "Recent check-ins",
        modifier = GlanceModifier.fillMaxWidth().height((cell * 7 + gap * 6).dp),
      )
      Spacer(GlanceModifier.defaultWeight())
      Row(modifier = GlanceModifier.fillMaxWidth()) {
        Text("last $weeks weeks", style = TextStyle(color = theme.provider(theme.inkSoft), fontSize = 10.sp))
        Spacer(GlanceModifier.defaultWeight())
        Text(
          "${snap.currentStreak}d streak",
          style = TextStyle(color = theme.provider(theme.accent), fontSize = 11.sp, fontWeight = FontWeight.Bold),
        )
      }
    }
  }
}

class YearReceiver : GlanceAppWidgetReceiver() {
  override val glanceAppWidget: GlanceAppWidget = YearWidget()
}

// MARK: Month progress

class ProgressWidget : GlanceAppWidget() {
  override val sizeMode = SizeMode.Exact
  override suspend fun provideGlance(context: Context, id: GlanceId) =
    provideContent { ProgressContent() }
}

@Composable
private fun ProgressContent() {
  val context = LocalContext.current
  val snap = snapshotOf(context)
  val theme = WidgetTheme.of(context, snap)
  val size = LocalSize.current
  val availW = size.width.value - PAD * 2
  val availH = size.height.value - PAD * 2
  val wide = size.width.value > size.height.value * 1.4f
  val fraction = if (snap.monthTotal > 0) snap.monthDone.toFloat() / snap.monthTotal else 0f

  WidgetScaffold(theme) {
    if (!wide) {
      val ring = minOf(availW, availH - 18f).coerceAtLeast(48f)
      Column(
        modifier = GlanceModifier.fillMaxSize(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalAlignment = Alignment.CenterVertically,
      ) {
        Box(contentAlignment = Alignment.Center) {
          Image(
            provider = ImageProvider(drawProgressRing(fraction, theme, context.px(ring), context.px(ring * 0.1f).toFloat())),
            contentDescription = "Month progress",
            modifier = GlanceModifier.size(ring.dp),
          )
          Text(
            "${snap.monthPct}%",
            style = TextStyle(color = theme.provider(theme.ink), fontSize = (ring / 4.2f).toInt().coerceIn(14, 30).sp, fontWeight = FontWeight.Bold),
          )
        }
        Spacer(GlanceModifier.height(5.dp))
        Text(snap.monthName, style = TextStyle(color = theme.provider(theme.inkSoft), fontSize = 10.sp, fontWeight = FontWeight.Bold))
      }
    } else {
      val ring = availH.coerceAtLeast(52f)
      Row(modifier = GlanceModifier.fillMaxSize(), verticalAlignment = Alignment.CenterVertically) {
        Box(contentAlignment = Alignment.Center) {
          Image(
            provider = ImageProvider(drawProgressRing(fraction, theme, context.px(ring), context.px(ring * 0.11f).toFloat())),
            contentDescription = "Month progress",
            modifier = GlanceModifier.size(ring.dp),
          )
          Text(
            "${snap.monthPct}%",
            style = TextStyle(color = theme.provider(theme.ink), fontSize = (ring / 4.6f).toInt().coerceIn(13, 24).sp, fontWeight = FontWeight.Bold),
          )
        }
        Spacer(GlanceModifier.width(14.dp))
        Column(modifier = GlanceModifier.defaultWeight()) {
          Heading(snap.monthName, theme)
          Spacer(GlanceModifier.defaultWeight())
          Stat("${snap.monthDone}", "checked off", theme)
          Stat("${snap.monthMissed}", "missed", theme)
          Stat("${snap.currentStreak}", "day streak", theme)
          Spacer(GlanceModifier.defaultWeight())
        }
      }
    }
  }
}

class ProgressReceiver : GlanceAppWidgetReceiver() {
  override val glanceAppWidget: GlanceAppWidget = ProgressWidget()
}

// MARK: Streak

class StreakWidget : GlanceAppWidget() {
  override val sizeMode = SizeMode.Exact
  override suspend fun provideGlance(context: Context, id: GlanceId) =
    provideContent { StreakContent() }
}

@Composable
private fun StreakContent() {
  val context = LocalContext.current
  val snap = snapshotOf(context)
  val theme = WidgetTheme.of(context, snap)
  val size = LocalSize.current
  val availH = size.height.value - PAD * 2
  val wide = size.width.value > size.height.value * 1.4f
  val pipCell = if (wide) 12f else (size.width.value / 12f).coerceIn(8f, 14f)
  val pips = drawPips(snap, theme, context.px(pipCell).toFloat(), context.px(3f).toFloat())
  val numberSize = (availH / 3.2f).toInt().coerceIn(28, 56)

  WidgetScaffold(theme) {
    if (!wide) {
      Column(
        modifier = GlanceModifier.fillMaxSize(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalAlignment = Alignment.CenterVertically,
      ) {
        Text(
          "${snap.currentStreak}",
          style = TextStyle(color = theme.provider(theme.done), fontSize = numberSize.sp, fontWeight = FontWeight.Bold),
        )
        Text("DAY STREAK", style = TextStyle(color = theme.provider(theme.inkSoft), fontSize = 9.sp, fontWeight = FontWeight.Bold))
        if (pips != null) {
          Spacer(GlanceModifier.height(7.dp))
          Image(provider = ImageProvider(pips), contentDescription = "Last 7 days", modifier = GlanceModifier.height(pipCell.dp))
        }
        Spacer(GlanceModifier.height(6.dp))
        Text(
          "best ${snap.bestStreak} · ${snap.perfectStreak} perfect",
          style = TextStyle(color = theme.provider(theme.inkSoft), fontSize = 10.sp),
        )
      }
    } else {
      Row(modifier = GlanceModifier.fillMaxSize(), verticalAlignment = Alignment.CenterVertically) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
          Text(
            "${snap.currentStreak}",
            style = TextStyle(color = theme.provider(theme.done), fontSize = numberSize.sp, fontWeight = FontWeight.Bold),
          )
          Text("DAYS", style = TextStyle(color = theme.provider(theme.inkSoft), fontSize = 9.sp, fontWeight = FontWeight.Bold))
        }
        Spacer(GlanceModifier.width(14.dp))
        Column(modifier = GlanceModifier.defaultWeight()) {
          Heading("STREAK", theme)
          Spacer(GlanceModifier.defaultWeight())
          Stat("${snap.bestStreak}", "best this year", theme)
          Stat("${snap.perfectStreak}", "perfect days", theme)
          if (pips != null) {
            Spacer(GlanceModifier.height(7.dp))
            Image(provider = ImageProvider(pips), contentDescription = "Last 7 days", modifier = GlanceModifier.height(pipCell.dp))
          }
          Spacer(GlanceModifier.defaultWeight())
        }
      }
    }
  }
}

class StreakReceiver : GlanceAppWidgetReceiver() {
  override val glanceAppWidget: GlanceAppWidget = StreakWidget()
}

// MARK: Today's check

class TodayWidget : GlanceAppWidget() {
  override val sizeMode = SizeMode.Exact
  override suspend fun provideGlance(context: Context, id: GlanceId) =
    provideContent { TodayContent() }
}

@Composable
private fun StateChip(state: Int, theme: WidgetTheme) {
  Box(
    modifier = GlanceModifier.size(14.dp).cornerRadius(4.dp).background(theme.provider(theme.stateColor(state))),
    contentAlignment = Alignment.Center,
  ) {
    if (state != 0) {
      Text(
        text = if (state == 1) "✓" else "✕",
        style = TextStyle(color = theme.provider(theme.onState), fontSize = 9.sp, fontWeight = FontWeight.Bold),
      )
    }
  }
}

@Composable
private fun TodayContent() {
  val context = LocalContext.current
  val snap = snapshotOf(context)
  val theme = WidgetTheme.of(context, snap)
  val size = LocalSize.current
  val availH = size.height.value - PAD * 2

  val today = snap.today
  val rows = if (today == null) emptyList() else snap.habits.mapIndexed { i, h ->
    (h.name.ifEmpty { "Unnamed habit" }) to snap.state(today, i)
  }
  val done = rows.count { it.second == 1 }

  // how many rows actually fit, rather than a fixed cap that leaves a gap
  val footer = if (availH >= 120f) 20f else 0f
  val fits = ((availH - 18f - footer) / 22f).toInt().coerceIn(1, 10)
  val visible = rows.take(fits)

  WidgetScaffold(theme) {
    Column(modifier = GlanceModifier.fillMaxSize()) {
      Heading("TODAY", theme, if (rows.isEmpty()) null else "$done/${rows.size}")
      Spacer(GlanceModifier.height(4.dp))
      if (rows.isEmpty()) {
        Text(
          "Open the app to sync this month.",
          style = TextStyle(color = theme.provider(theme.inkSoft), fontSize = 11.sp),
        )
      } else {
        visible.forEach { (name, state) ->
          Row(
            modifier = GlanceModifier.fillMaxWidth().padding(vertical = 3.dp),
            verticalAlignment = Alignment.CenterVertically,
          ) {
            StateChip(state, theme)
            Spacer(GlanceModifier.width(7.dp))
            Text(
              text = name,
              maxLines = 1,
              style = TextStyle(color = theme.provider(if (state == 1) theme.inkSoft else theme.ink), fontSize = 12.sp),
            )
          }
        }
        if (rows.size > visible.size) {
          Text(
            "+${rows.size - visible.size} more",
            style = TextStyle(color = theme.provider(theme.inkSoft), fontSize = 10.sp),
          )
        }
      }
      Spacer(GlanceModifier.defaultWeight())
      if (footer > 0f) StatFooter(snap, theme)
    }
  }
}

class TodayReceiver : GlanceAppWidgetReceiver() {
  override val glanceAppWidget: GlanceAppWidget = TodayWidget()
}

// MARK: Key goals

class GoalsWidget : GlanceAppWidget() {
  override val sizeMode = SizeMode.Exact
  override suspend fun provideGlance(context: Context, id: GlanceId) =
    provideContent { GoalsContent() }
}

@Composable
private fun GoalsContent() {
  val context = LocalContext.current
  val snap = snapshotOf(context)
  val theme = WidgetTheme.of(context, snap)
  val size = LocalSize.current
  val availH = size.height.value - PAD * 2
  // A goal nobody has written is not a goal, so it cannot be a goal that is
  // done. The app's own card counts it that way (`KeyGoals.tsx`), and a widget
  // that disagreed with the screen it mirrors read as a bug: marking an empty
  // box done showed 1/3 here and 0/3 in the app.
  val doneCount = snap.goals.count { it.done && it.text.isNotEmpty() }

  WidgetScaffold(theme) {
    Column(modifier = GlanceModifier.fillMaxSize()) {
      Heading("KEY GOALS", theme, if (snap.goals.isEmpty()) null else "$doneCount/${snap.goals.size}")
      Spacer(GlanceModifier.height(4.dp))
      if (snap.goals.all { it.text.isEmpty() }) {
        Text(
          "Set this month's goals in the app.",
          style = TextStyle(color = theme.provider(theme.inkSoft), fontSize = 11.sp),
        )
      } else {
        snap.goals.forEach { goal ->
          Row(
            modifier = GlanceModifier.fillMaxWidth().padding(vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
          ) {
            StateChip(if (goal.done) 1 else 0, theme)
            Spacer(GlanceModifier.width(8.dp))
            Text(
              text = goal.text.ifEmpty { "—" },
              maxLines = 1,
              style = TextStyle(
                color = theme.provider(if (goal.done) theme.done else theme.ink),
                fontSize = 13.sp,
                fontWeight = FontWeight.Medium,
              ),
            )
          }
        }
      }
      Spacer(GlanceModifier.defaultWeight())
      // three goals never fill a 4x2, so the leftover carries the month summary
      if (availH >= 90f) StatFooter(snap, theme)
    }
  }
}

class GoalsReceiver : GlanceAppWidgetReceiver() {
  override val glanceAppWidget: GlanceAppWidget = GoalsWidget()
}

// MARK: Daily quote

class QuoteWidget : GlanceAppWidget() {
  override val sizeMode = SizeMode.Exact
  override suspend fun provideGlance(context: Context, id: GlanceId) =
    provideContent { QuoteContent() }
}

@Composable
private fun QuoteContent() {
  val context = LocalContext.current
  val snap = snapshotOf(context)
  val theme = WidgetTheme.of(context, snap)
  val size = LocalSize.current
  val availW = size.width.value - PAD * 2
  val availH = size.height.value - PAD * 2
  val calendar = Calendar.getInstance()
  val dayOfYear = calendar.get(Calendar.DAY_OF_YEAR)
  val quote = snap.quote(dayOfYear)
  // the full year strip needs width as well as height — on a narrow card its two
  // captions collide, so a narrow-but-tall widget gets the compact bar instead
  val tall = availH >= 170f
  val roomy = tall && availW >= 200f
  val fontSize = if (size.width.value < 200f) 12 else if (tall) 17 else 14

  WidgetScaffold(theme) {
    Column(modifier = GlanceModifier.fillMaxSize()) {
      Heading("DISCIPLINE.", theme)
      // spacers either side keep a short quote centred instead of pooling all
      // the slack underneath it
      Spacer(GlanceModifier.defaultWeight())
      if (quote == null) {
        Text(
          "Open the app to sync today's quote.",
          style = TextStyle(color = theme.provider(theme.inkSoft), fontSize = 11.sp),
        )
      } else {
        Text(
          text = "“$quote”",
          style = TextStyle(
            color = theme.provider(theme.ink),
            fontSize = fontSize.sp,
            fontWeight = FontWeight.Medium,
            fontStyle = FontStyle.Italic,
          ),
        )
      }
      Spacer(GlanceModifier.defaultWeight())
      if (tall) {
        val total = snap.habits.size
        val doneToday = snap.today?.let { snap.doneCount(it) } ?: 0
        Row(modifier = GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
          if (total > 0) Stat("$doneToday/$total", "done today", theme, size = 13)
          Spacer(GlanceModifier.defaultWeight())
          Text(
            "${snap.currentStreak}d",
            style = TextStyle(color = theme.provider(theme.accent), fontSize = 12.sp, fontWeight = FontWeight.Bold),
          )
        }
        Spacer(GlanceModifier.height(6.dp))
        YearBar(snap, theme, dayOfYear, calendar.getActualMaximum(Calendar.DAY_OF_YEAR), availW, roomy)
      } else if (availH >= 110f) {
        StatFooter(snap, theme)
      }
    }
  }
}

@Composable
private fun YearBar(
  snap: PlannerSnapshot,
  theme: WidgetTheme,
  dayOfYear: Int,
  daysInYear: Int,
  availW: Float,
  roomy: Boolean,
) {
  val context = LocalContext.current
  val fraction = (dayOfYear.toFloat() / daysInYear).coerceIn(0f, 1f)
  Column(modifier = GlanceModifier.fillMaxWidth()) {
    if (roomy) {
      Row(modifier = GlanceModifier.fillMaxWidth()) {
        Text(
          "${snap.year}",
          style = TextStyle(color = theme.provider(theme.ink), fontSize = 11.sp, fontWeight = FontWeight.Bold),
        )
        Spacer(GlanceModifier.defaultWeight())
        Text(
          "day $dayOfYear of $daysInYear",
          style = TextStyle(color = theme.provider(theme.inkSoft), fontSize = 10.sp),
        )
      }
      Spacer(GlanceModifier.height(4.dp))
    }
    Image(
      provider = ImageProvider(drawProgressBar(fraction, theme, context.px(availW), context.px(6f))),
      contentDescription = "Year progress",
      modifier = GlanceModifier.fillMaxWidth().height(6.dp),
    )
    Spacer(GlanceModifier.height(4.dp))
    Row(modifier = GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
      Text(
        if (roomy) "${(fraction * 100).toInt()}% through the year" else "${(fraction * 100).toInt()}% of ${snap.year}",
        style = TextStyle(color = theme.provider(theme.inkSoft), fontSize = 10.sp),
      )
      Spacer(GlanceModifier.defaultWeight())
      Spacer(GlanceModifier.width(6.dp))
      Text(
        if (roomy) "${snap.yearTotal} check-ins" else "${snap.yearTotal}",
        style = TextStyle(color = theme.provider(theme.done), fontSize = 10.sp, fontWeight = FontWeight.Bold),
      )
    }
  }
}

class QuoteReceiver : GlanceAppWidgetReceiver() {
  override val glanceAppWidget: GlanceAppWidget = QuoteWidget()
}
