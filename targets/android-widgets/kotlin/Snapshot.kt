package com.owaiskhan.monthlyplanning.widgets

import org.json.JSONArray
import org.json.JSONObject

// Mirrors `WidgetSnapshot` in src/widgets/snapshot.ts; org.json keeps the widgets dependency-free.
data class Habit(val id: String, val name: String)

data class Goal(val text: String, val done: Boolean)

data class DeadlineTask(
  val text: String,
  /** epoch milliseconds */
  val due: Long,
  /** "weekly" / "monthly" / "yearly" on a recurring deadline, null on a one-off */
  val repeats: String? = null,
)

data class PlannerSnapshot(
  /** "dark" or "light"; null falls back to the system setting */
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
    /** Where WidgetBridgeModule stores the JSON. */
    const val PREFS = "widget_snapshot"
    const val KEY = "widgetSnapshot"

    fun from(json: String?): PlannerSnapshot? =
      json?.let { runCatching { parse(JSONObject(it)) }.getOrNull() }

    /** Maps each index of a possibly missing array; a missing one reads as empty. */
    private fun <T> JSONArray?.items(read: JSONArray.(Int) -> T): List<T> {
      val array = this ?: return emptyList()
      return List(array.length()) { array.read(it) }
    }

    private fun intMatrix(array: JSONArray?): List<List<Int>> =
      array.items { i -> optJSONArray(i).items { optInt(it) } }

    private fun parse(o: JSONObject): PlannerSnapshot {
      val habits = o.optJSONArray("habits").items {
        val h = getJSONObject(it)
        Habit(h.optString("id"), h.optString("name"))
      }
      val goals = o.optJSONArray("goals").items {
        val g = getJSONObject(it)
        Goal(g.optString("text"), g.optBoolean("done"))
      }
      val grid = mutableMapOf<String, String>()
      o.optJSONObject("grid")?.let { g ->
        g.keys().forEach { key -> grid[key] = g.optString(key) }
      }
      val tasks = o.optJSONArray("tasks").items {
        val t = getJSONObject(it)
        DeadlineTask(
          t.optString("text"),
          t.optLong("due"),
          if (t.isNull("repeats")) null else t.optString("repeats").ifEmpty { null },
        )
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
        yearHabitCounts = o.optJSONArray("yearHabitCounts").items { optInt(it) },
        yearTotal = o.optInt("yearTotal"),
        quotes = o.optJSONArray("quotes").items { optString(it) },
        ownQuotesFrom = o.optInt("ownQuotesFrom", Int.MAX_VALUE),
        tasks = tasks,
      )
    }

    /** Shown in the widget picker and before the app has ever written a snapshot. */
    val placeholder = PlannerSnapshot(
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
