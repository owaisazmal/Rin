package com.owaiskhan.monthlyplanning.widgets

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * Mirrors `WidgetSnapshot` in src/widgets/snapshot.ts, same as the Swift
 * `PlannerSnapshot`. Parsed with org.json rather than a serialization library
 * so the widgets pull in no extra dependencies.
 */
data class Habit(val id: String, val name: String)

data class Goal(val text: String, val done: Boolean)

/**
 * A task with a deadline. `due` is the moment itself in epoch milliseconds, not
 * a distance to it — the widget works out how far off it is against its own
 * clock, so the countdown stays true between snapshots.
 */
data class DeadlineTask(
  val text: String,
  val due: Long,
  /** "weekly" / "monthly" / "yearly" on a recurring deadline, null on a one-off */
  val repeats: String? = null,
)

data class PlannerSnapshot(
  /**
   * The app's appearance setting — "dark" or "light". Null for snapshots
   * written before the widgets followed the app, and for the picker preview;
   * both fall back to the system setting.
   */
  val theme: String?,
  val year: Int,
  val month: Int,
  val monthName: String,
  val daysInMonth: Int,
  val today: Int?,
  val habits: List<Habit>,
  val grid: Map<String, String>,
  val monthDone: Int,
  val monthMissed: Int,
  val monthTotal: Int,
  val monthPct: Int,
  val currentStreak: Int,
  val bestStreak: Int,
  val perfectStreak: Int,
  val goals: List<Goal>,
  val yearDone: List<List<Int>>,
  val yearMissed: List<List<Int>>,
  val yearHabitCounts: List<Int>,
  val yearTotal: Int,
  val quotes: List<String>,
  /** where the user's own quotes begin in `quotes`; older snapshots hold none */
  val ownQuotesFrom: Int = Int.MAX_VALUE,
  /** unfinished deadlines, soonest first — overdue ones included, and first */
  val tasks: List<DeadlineTask>,
) {
  /** 0 pending, 1 done, 2 missed */
  fun state(day: Int, habitIndex: Int): Int {
    val row = grid[day.toString()] ?: return 0
    if (habitIndex < 0 || habitIndex >= row.length) return 0
    return row[habitIndex].digitToIntOrNull() ?: 0
  }

  fun doneCount(day: Int): Int = grid[day.toString()]?.count { it == '1' } ?: 0

  /** Same day-of-year rotation as quoteForDate in src/quotes.ts. */
  fun quote(dayOfYear: Int): String? =
    if (quotes.isEmpty()) null else quotes[dayOfYear % quotes.size]

  /** Whether the day's quote is the user's own, which quoteHeading in src/quotes.ts heads "YOUR WORDS." */
  fun quoteIsOwn(dayOfYear: Int): Boolean =
    quotes.isNotEmpty() && dayOfYear % quotes.size >= ownQuotesFrom

  companion object {
    fun load(context: Context): PlannerSnapshot? {
      val json = context
        .getSharedPreferences("widget_snapshot", Context.MODE_PRIVATE)
        .getString("widgetSnapshot", null) ?: return null
      return runCatching { parse(JSONObject(json)) }.getOrNull()
    }

    private fun intMatrix(array: JSONArray?): List<List<Int>> {
      if (array == null) return emptyList()
      return (0 until array.length()).map { i ->
        val row = array.optJSONArray(i) ?: JSONArray()
        (0 until row.length()).map { row.optInt(it) }
      }
    }

    private fun parse(o: JSONObject): PlannerSnapshot {
      val habits = o.optJSONArray("habits").let { arr ->
        (0 until (arr?.length() ?: 0)).map {
          val h = arr!!.getJSONObject(it)
          Habit(h.optString("id"), h.optString("name"))
        }
      }
      val goals = o.optJSONArray("goals").let { arr ->
        (0 until (arr?.length() ?: 0)).map {
          val g = arr!!.getJSONObject(it)
          Goal(g.optString("text"), g.optBoolean("done"))
        }
      }
      val grid = mutableMapOf<String, String>()
      o.optJSONObject("grid")?.let { g ->
        g.keys().forEach { key -> grid[key] = g.optString(key) }
      }
      val quotes = o.optJSONArray("quotes").let { arr ->
        (0 until (arr?.length() ?: 0)).map { arr!!.optString(it) }
      }
      // absent from snapshots written before deadlines existed, which must
      // still parse rather than taking every other widget down with them
      val tasks = o.optJSONArray("tasks").let { arr ->
        (0 until (arr?.length() ?: 0)).map {
          val t = arr!!.getJSONObject(it)
          DeadlineTask(
            t.optString("text"),
            t.optLong("due"),
            if (t.isNull("repeats")) null else t.optString("repeats").ifEmpty { null },
          )
        }
      }.sortedBy { it.due }
      return PlannerSnapshot(
        theme = if (o.isNull("theme")) null else o.optString("theme").ifEmpty { null },
        year = o.optInt("year"),
        month = o.optInt("month"),
        monthName = o.optString("monthName"),
        daysInMonth = o.optInt("daysInMonth", 30),
        today = if (o.isNull("today")) null else o.optInt("today"),
        habits = habits,
        grid = grid,
        monthDone = o.optInt("monthDone"),
        monthMissed = o.optInt("monthMissed"),
        monthTotal = o.optInt("monthTotal"),
        monthPct = o.optInt("monthPct"),
        currentStreak = o.optInt("currentStreak"),
        bestStreak = o.optInt("bestStreak"),
        perfectStreak = o.optInt("perfectStreak"),
        goals = goals,
        yearDone = intMatrix(o.optJSONArray("yearDone")),
        yearMissed = intMatrix(o.optJSONArray("yearMissed")),
        yearHabitCounts = o.optJSONArray("yearHabitCounts").let { arr ->
          (0 until (arr?.length() ?: 0)).map { arr!!.optInt(it) }
        },
        yearTotal = o.optInt("yearTotal"),
        quotes = quotes,
        ownQuotesFrom = o.optInt("ownQuotesFrom", Int.MAX_VALUE),
        tasks = tasks,
      )
    }

    /** Shown in the widget picker and before the app has ever written a snapshot. */
    val placeholder = PlannerSnapshot(
      // the picker preview has no app setting to follow yet
      theme = null,
      year = 2026,
      month = 7,
      monthName = "AUGUST",
      daysInMonth = 31,
      today = 15,
      habits = listOf(
        Habit("0", "Read 20 pages"),
        Habit("1", "Gym"),
        Habit("2", "No sugar"),
        Habit("3", "Deep work"),
      ),
      grid = (1..15).associate { it.toString() to listOf("1110", "1101", "1111", "1011", "1210")[it % 5] },
      monthDone = 52,
      monthMissed = 6,
      monthTotal = 124,
      monthPct = 42,
      currentStreak = 9,
      bestStreak = 21,
      perfectStreak = 3,
      goals = listOf(Goal("Ship v1", true), Goal("Run 50k", false), Goal("Read 3 books", false)),
      yearDone = (0 until 12).map { m -> (0 until 30).map { if (m <= 7) (it % 4) else 0 } },
      yearMissed = (0 until 12).map { (0 until 30).map { 0 } },
      yearHabitCounts = List(12) { 4 },
      yearTotal = 318,
      quotes = listOf("Discipline is choosing between what you want now and what you want most."),
      tasks = listOf(
        DeadlineTask("Send the tax return", System.currentTimeMillis() + 5 * 3_600_000L),
        DeadlineTask("Book the flights", System.currentTimeMillis() + 2 * 86_400_000L),
        DeadlineTask("Finish the draft", System.currentTimeMillis() + 6 * 86_400_000L),
      ),
    )
  }
}
