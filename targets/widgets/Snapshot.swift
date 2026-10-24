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
    /// epoch milliseconds
    let due: Double
    /// "weekly" / "monthly" / "yearly" on a recurring deadline, nil on a one-off
    var repeats: String? = nil

    var date: Date { Date(timeIntervalSince1970: due / 1000) }
    var title: String { text.isEmpty ? "Untitled task" : text }
  }

  let updatedAt: Double
  /// "dark" or "light"; optional so older snapshots still decode
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
  // optional so snapshots from before these features still decode
  let quotes: [String]?
  /// where the user's own quotes begin in `quotes`
  let ownQuotesFrom: Int?
  let tasks: [Task]?

  /// Unfinished deadlines, soonest first, overdue ones included.
  var deadlines: [Task] {
    (tasks ?? []).sorted { $0.due < $1.due }
  }

  /// The day's quote then the rest in rotation order, same as `quoteForDate` in src/quotes.ts.
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

  /// The week up to today, for the run of pips.
  var recentDays: [(day: Int, done: Bool)] {
    guard let today else { return [] }
    return (max(1, today - 6)...today).map { ($0, doneCount(day: $0) > 0) }
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
      grid[String(d)] = ["1110", "1101", "1111", "1011", "1210"][d % 5]
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

struct SnapshotEntry: TimelineEntry {
  let date: Date
  let snapshot: PlannerSnapshot
}

/// One provider serves every widget — they all render from the same snapshot.
struct SnapshotProvider: TimelineProvider {
  /// The App Group must match app.json, expo-target.config.js and WidgetBridgeModule.swift.
  private func load() -> PlannerSnapshot {
    guard
      let json = UserDefaults(suiteName: "group.com.owaiskhan.monthlyplanning")?.string(forKey: "widgetSnapshot"),
      let snapshot = try? JSONDecoder().decode(PlannerSnapshot.self, from: Data(json.utf8))
    else { return .placeholder }
    return snapshot
  }

  func placeholder(in context: Context) -> SnapshotEntry {
    SnapshotEntry(date: Date(), snapshot: .placeholder)
  }

  func getSnapshot(in context: Context, completion: @escaping (SnapshotEntry) -> Void) {
    completion(SnapshotEntry(date: Date(), snapshot: load()))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<SnapshotEntry>) -> Void) {
    let snapshot = load()
    let now = Date()

    // the app reloads on every change; entries only cover midnight and the countdowns stepping down
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

    let entries = dates.map { SnapshotEntry(date: $0, snapshot: snapshot) }
    completion(Timeline(entries: entries, policy: .after(dates.last ?? midnight)))
  }
}
