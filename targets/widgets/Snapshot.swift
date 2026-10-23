import Foundation
import WidgetKit

/// Mirrors `WidgetSnapshot` in src/widgets/snapshot.ts. Both sides must change together.
struct PlannerSnapshot: Codable {
  struct Habit: Codable {
    let id: String
    let name: String
  }

  struct Goal: Codable {
    let text: String
    let done: Bool
  }

  struct Task: Codable {
    let text: String
    /// The deadline, epoch milliseconds — the app's clock, not a countdown.
    /// Storing the moment rather than the distance to it is what lets the
    /// widget stay accurate between snapshots.
    let due: Double
    /// "weekly" / "monthly" / "yearly" on a recurring deadline, nil on a one-off
    var repeats: String? = nil

    var date: Date { Date(timeIntervalSince1970: due / 1000) }
  }

  let updatedAt: Double
  /// The app's appearance setting — "dark" or "light". Optional because
  /// snapshots written before the widgets followed the app have no such key,
  /// and a missing one falls back to the system scheme rather than failing.
  let theme: String?
  let year: Int
  /// 0-based, matching the app
  let month: Int
  let monthName: String
  let daysInMonth: Int
  let today: Int?
  let habits: [Habit]
  /// day → one character per habit: "0" pending, "1" done, "2" missed
  let grid: [String: String]
  let monthDone: Int
  let monthMissed: Int
  let monthTotal: Int
  let monthPct: Int
  let currentStreak: Int
  let bestStreak: Int
  let perfectStreak: Int
  let goals: [Goal]
  let yearDone: [[Int]]
  let yearMissed: [[Int]]
  let yearHabitCounts: [Int]
  let yearTotal: Int
  /// Decoded leniently — snapshots written before the quote widget existed
  /// have no `quotes` key, and a missing one shouldn't fail the whole decode.
  let quotes: [String]?
  /// Where the user's own quotes begin in `quotes`; absent from older snapshots, which hold none
  let ownQuotesFrom: Int?
  /// Likewise optional: a snapshot written before deadlines existed carries no
  /// `tasks` key, and that must not fail the decode for every other widget.
  let tasks: [Task]?

  /// Unfinished deadlines, soonest first — overdue ones included, and first in
  /// the list, since a deadline that has gone by is the one worth showing.
  var deadlines: [Task] {
    (tasks ?? []).sorted { $0.due < $1.due }
  }

  /// Same day-of-year rotation as `quoteForDate` in src/quotes.ts, so the app
  /// and the widget always show the same quote on a given day.
  func quote(on date: Date) -> String? {
    guard let quotes, !quotes.isEmpty else { return nil }
    let cal = Calendar.current
    guard let dayOfYear = cal.ordinality(of: .day, in: .year, for: date) else { return nil }
    return quotes[dayOfYear % quotes.count]
  }

  /// Whether the day's quote is one the user wrote, which `quoteHeading` in src/quotes.ts heads "YOUR WORDS."
  func quoteIsOwn(on date: Date) -> Bool {
    guard let quotes, !quotes.isEmpty, let ownQuotesFrom,
          let dayOfYear = Calendar.current.ordinality(of: .day, in: .year, for: date) else { return false }
    return dayOfYear % quotes.count >= ownQuotesFrom
  }

  /// The day's quote and the ones after it in rotation order, each marked when the user wrote it.
  func rotation(from date: Date) -> [(text: String, own: Bool)] {
    guard let quotes, !quotes.isEmpty,
          let dayOfYear = Calendar.current.ordinality(of: .day, in: .year, for: date) else { return [] }
    return (0..<quotes.count).map { step in
      let i = (dayOfYear + step) % quotes.count
      return (quotes[i], ownQuotesFrom.map { i >= $0 } ?? false)
    }
  }

  /// 0 pending, 1 done, 2 missed
  func state(day: Int, habitIndex: Int) -> Int {
    guard let row = grid[String(day)] else { return 0 }
    let chars = Array(row)
    guard habitIndex >= 0, habitIndex < chars.count else { return 0 }
    return Int(String(chars[habitIndex])) ?? 0
  }

  func doneCount(day: Int) -> Int {
    guard let row = grid[String(day)] else { return 0 }
    return row.filter { $0 == "1" }.count
  }

  func missedCount(day: Int) -> Int {
    guard let row = grid[String(day)] else { return 0 }
    return row.filter { $0 == "2" }.count
  }

  /// Shown before the app has ever written a snapshot, and in the widget gallery.
  static let placeholder: PlannerSnapshot = {
    let now = Date()
    let cal = Calendar.current
    let year = cal.component(.year, from: now)
    let month = cal.component(.month, from: now) - 1
    let day = cal.component(.day, from: now)
    let range = cal.range(of: .day, in: .month, for: now)?.count ?? 30
    let names = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE",
                 "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"]

    var grid: [String: String] = [:]
    for d in 1...max(day, 1) {
      // a plausible-looking sample so the gallery preview isn't empty
      let pattern = ["1110", "1101", "1111", "1011", "1210"][d % 5]
      grid[String(d)] = pattern
    }

    var yearDone: [[Int]] = []
    var yearMissed: [[Int]] = []
    for m in 0..<12 {
      var comps = DateComponents()
      comps.year = year
      comps.month = m + 1
      let len = cal.range(of: .day, in: .month, for: cal.date(from: comps) ?? now)?.count ?? 30
      yearDone.append((0..<len).map { m <= month ? ($0 % 4 == 0 ? 0 : ($0 % 3) + 1) : 0 })
      yearMissed.append(Array(repeating: 0, count: len))
    }

    return PlannerSnapshot(
      updatedAt: now.timeIntervalSince1970 * 1000,
      // the gallery preview has no app setting to follow yet
      theme: nil,
      year: year,
      month: month,
      monthName: names[min(max(month, 0), 11)],
      daysInMonth: range,
      today: day,
      habits: [
        .init(id: "0", name: "Read 20 pages"),
        .init(id: "1", name: "Gym"),
        .init(id: "2", name: "No sugar"),
        .init(id: "3", name: "Deep work"),
      ],
      grid: grid,
      monthDone: 52,
      monthMissed: 6,
      monthTotal: 124,
      monthPct: 42,
      currentStreak: 9,
      bestStreak: 21,
      perfectStreak: 3,
      goals: [
        .init(text: "Ship v1", done: true),
        .init(text: "Run 50k", done: false),
        .init(text: "Read 3 books", done: false),
      ],
      yearDone: yearDone,
      yearMissed: yearMissed,
      yearHabitCounts: Array(repeating: 4, count: 12),
      yearTotal: 318,
      quotes: [
        "Discipline is choosing between what you want now and what you want most.",
        "We are what we repeatedly do. Excellence, then, is not an act, but a habit.",
        "You don't have to be extreme, just consistent.",
      ],
      ownQuotesFrom: nil,
      tasks: [
        .init(text: "Send the tax return", due: now.addingTimeInterval(5 * 3600).timeIntervalSince1970 * 1000),
        .init(text: "Book the flights", due: now.addingTimeInterval(2 * 86400).timeIntervalSince1970 * 1000),
        .init(text: "Finish the draft", due: now.addingTimeInterval(6 * 86400).timeIntervalSince1970 * 1000),
      ]
    )
  }()
}

enum SnapshotStore {
  /// Must match app.json, expo-target.config.js and WidgetBridgeModule.swift.
  static let appGroup = "group.com.owaiskhan.monthlyplanning"
  static let key = "widgetSnapshot"

  static func load() -> PlannerSnapshot? {
    guard
      let defaults = UserDefaults(suiteName: appGroup),
      let json = defaults.string(forKey: key),
      let data = json.data(using: .utf8)
    else { return nil }
    return try? JSONDecoder().decode(PlannerSnapshot.self, from: data)
  }
}

struct SnapshotEntry: TimelineEntry {
  let date: Date
  let snapshot: PlannerSnapshot
  /// true when no snapshot has been written yet, so views can nudge the user
  let isPlaceholder: Bool
}

/// One provider serves every widget — they all render from the same snapshot.
struct SnapshotProvider: TimelineProvider {
  func placeholder(in context: Context) -> SnapshotEntry {
    SnapshotEntry(date: Date(), snapshot: .placeholder, isPlaceholder: true)
  }

  func getSnapshot(in context: Context, completion: @escaping (SnapshotEntry) -> Void) {
    let loaded = SnapshotStore.load()
    completion(
      SnapshotEntry(
        date: Date(),
        snapshot: loaded ?? .placeholder,
        isPlaceholder: loaded == nil
      )
    )
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<SnapshotEntry>) -> Void) {
    let loaded = SnapshotStore.load()
    let snapshot = loaded ?? .placeholder
    let now = Date()

    // The app reloads timelines whenever the data changes, so a timeline only
    // has to cover what moves on its own: "today" rolling over at midnight, and
    // every countdown stepping down. Those are entries, not reloads — WidgetKit
    // budgets how often an extension may be woken, but not how many entries it
    // hands back when it is.
    let midnight =
      Calendar.current.nextDate(
        after: now,
        matching: DateComponents(hour: 0, minute: 1),
        matchingPolicy: .nextTime
      ) ?? now.addingTimeInterval(3600)

    var dates = [now]
    dates += Deadline.labelChanges(after: now, in: snapshot, limit: 28)
    dates.append(midnight)
    dates = Array(Set(dates)).sorted()

    let entries = dates.map {
      SnapshotEntry(date: $0, snapshot: snapshot, isPlaceholder: loaded == nil)
    }
    completion(Timeline(entries: entries, policy: .after(dates.last ?? midnight)))
  }
}
