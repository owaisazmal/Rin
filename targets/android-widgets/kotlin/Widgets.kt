package com.owaiskhan.monthlyplanning.widgets

import android.content.Context
import android.content.SharedPreferences
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.unit.DpSize
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

// SizeMode.Exact everywhere: layouts are sized from the real widget size, which Responsive rounds to a breakpoint.

private const val PAD = 12f

private fun Context.px(dp: Float): Int = (dp * resources.displayMetrics.density).toInt()

/** What every widget body reads: the snapshot, its theme and the room inside the padding. */
class WidgetScope(val context: Context, val size: DpSize, val snap: PlannerSnapshot) {
  val theme = WidgetTheme.of(context, snap)
  val availW = size.width.value - PAD * 2
  val availH = size.height.value - PAD * 2
  val wide = size.width.value > size.height.value * 1.4f
}

// each widget keeps its own class, since receivers and Glance state are keyed by class
abstract class PlannerWidget(private val content: @Composable WidgetScope.() -> Unit) : GlanceAppWidget() {
  override val sizeMode = SizeMode.Exact
  override suspend fun provideGlance(context: Context, id: GlanceId) = provideContent {
    val scope = WidgetScope(LocalContext.current, LocalSize.current, rememberSnapshot(context))
    Box(
      modifier = GlanceModifier
        .fillMaxSize()
        .background(scope.theme.provider(scope.theme.bg))
        .cornerRadius(20.dp)
        .padding(PAD.dp)
    ) { scope.content() }
  }
}

abstract class PlannerReceiver(override val glanceAppWidget: GlanceAppWidget) : GlanceAppWidgetReceiver()

// an update sent while a session is open only recomposes on state, so the stored JSON is held as state
@Composable
private fun rememberSnapshot(context: Context): PlannerSnapshot {
  val prefs = remember { context.getSharedPreferences(PlannerSnapshot.PREFS, Context.MODE_PRIVATE) }
  var json by remember { mutableStateOf(prefs.getString(PlannerSnapshot.KEY, null)) }
  DisposableEffect(prefs) {
    val listener = SharedPreferences.OnSharedPreferenceChangeListener { p, key ->
      if (key == PlannerSnapshot.KEY) json = p.getString(key, null)
    }
    prefs.registerOnSharedPreferenceChangeListener(listener)
    onDispose { prefs.unregisterOnSharedPreferenceChangeListener(listener) }
  }
  return remember(json) { PlannerSnapshot.from(json) ?: PlannerSnapshot.placeholder }
}

@Composable
internal fun Heading(text: String, theme: WidgetTheme, trailing: String? = null) {
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

/** Fills the room a list leaves underneath. */
@Composable
private fun WidgetScope.StatFooter() {
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

class RadialWidget : PlannerWidget({ RadialContent() })
class RadialReceiver : PlannerReceiver(RadialWidget())

@Composable
private fun WidgetScope.RadialContent() {
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

// MARK: Year tracker

class YearWidget : PlannerWidget({ YearContent() })
class YearReceiver : PlannerReceiver(YearWidget())

@Composable
private fun WidgetScope.YearContent() {
  // the grid takes whatever height is left, and the cell size follows from it
  val gridH = (availH - 34f).coerceAtLeast(28f)
  val gap = 2f
  val cell = ((gridH - gap * 6f) / 7f).coerceIn(3f, 16f)
  val weeks = ((availW + gap) / (cell + gap)).toInt().coerceIn(4, 53)

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

// MARK: Month progress

class ProgressWidget : PlannerWidget({ ProgressContent() })
class ProgressReceiver : PlannerReceiver(ProgressWidget())

@Composable
private fun WidgetScope.ProgressContent() {
  val fraction = if (snap.monthTotal > 0) snap.monthDone.toFloat() / snap.monthTotal else 0f

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

// MARK: Streak

class StreakWidget : PlannerWidget({ StreakContent() })
class StreakReceiver : PlannerReceiver(StreakWidget())

@Composable
private fun WidgetScope.StreakContent() {
  val pipCell = if (wide) 12f else (size.width.value / 12f).coerceIn(8f, 14f)
  val pips = drawPips(snap, theme, context.px(pipCell).toFloat(), context.px(3f).toFloat())
  val numberSize = (availH / 3.2f).toInt().coerceIn(28, 56)

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

// MARK: Today's check

class TodayWidget : PlannerWidget({ TodayContent() })
class TodayReceiver : PlannerReceiver(TodayWidget())

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
private fun WidgetScope.TodayContent() {
  val today = snap.today
  val rows = if (today == null) emptyList() else snap.habits.mapIndexed { i, h ->
    (h.name.ifEmpty { "Unnamed habit" }) to snap.state(today, i)
  }
  val done = rows.count { it.second == 1 }

  // how many rows actually fit, rather than a fixed cap that leaves a gap
  val footer = if (availH >= 120f) 20f else 0f
  val fits = ((availH - 18f - footer) / 22f).toInt().coerceIn(1, 10)
  val visible = rows.take(fits)

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
    if (footer > 0f) StatFooter()
  }
}

// MARK: Key goals

class GoalsWidget : PlannerWidget({ GoalsContent() })
class GoalsReceiver : PlannerReceiver(GoalsWidget())

@Composable
private fun WidgetScope.GoalsContent() {
  // empty goals don't count as done, matching KeyGoals.tsx
  val doneCount = snap.goals.count { it.done && it.text.isNotEmpty() }

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
    if (availH >= 90f) StatFooter()
  }
}

// MARK: Daily quote

class QuoteWidget : PlannerWidget({ QuoteContent() })
class QuoteReceiver : PlannerReceiver(QuoteWidget())

@Composable
private fun WidgetScope.QuoteContent() {
  val calendar = Calendar.getInstance()
  val dayOfYear = calendar.get(Calendar.DAY_OF_YEAR)
  val quote = snap.quote(dayOfYear)
  // the full year strip's captions collide on a narrow card, which gets the compact bar
  val tall = availH >= 170f
  val roomy = tall && availW >= 200f
  val fontSize = if (size.width.value < 200f) 12 else if (tall) 17 else 14

  Column(modifier = GlanceModifier.fillMaxSize()) {
    Heading(if (snap.quoteIsOwn(dayOfYear)) "YOUR WORDS." else "DISCIPLINE.", theme)
    // spacers either side centre a short quote
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
      YearBar(dayOfYear, calendar.getActualMaximum(Calendar.DAY_OF_YEAR), roomy)
    } else if (availH >= 110f) {
      StatFooter()
    }
  }
}

@Composable
private fun WidgetScope.YearBar(dayOfYear: Int, daysInYear: Int, roomy: Boolean) {
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
