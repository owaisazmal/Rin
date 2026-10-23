import SwiftUI
import WidgetKit

// MARK: - Streak

struct StreakWidgetView: View {
  var entry: SnapshotEntry
  @Environment(\.widgetFamily) private var family
  @Environment(\.colorScheme) private var scheme

  /// The seven days leading up to today, for the little run of pips.
  private var recentDays: [(day: Int, done: Bool)] {
    let snap = entry.snapshot
    guard let today = snap.today else { return [] }
    let first = max(1, today - 6)
    return (first...today).map { ($0, snap.doneCount(day: $0) > 0) }
  }

  /// Lock Screen flame: filled once today is marked, an outline while the streak waits on today.
  private var flame: String {
    let snap = entry.snapshot
    let marked = snap.today.map { snap.doneCount(day: $0) > 0 } ?? (snap.currentStreak > 0)
    return marked ? "flame.fill" : "flame"
  }

  var body: some View {
    let theme = Theme.of(entry.snapshot, fallback: scheme)
    let snap = entry.snapshot

    switch family {
    case .accessoryCircular:
      ZStack {
        AccessoryWidgetBackground()
        VStack(spacing: -1) {
          Image(systemName: flame).font(.system(size: 12, weight: .semibold))
          Text("\(snap.currentStreak)")
            .font(.system(size: 24, weight: .bold, design: .rounded))
            .lineLimit(1)
            .minimumScaleFactor(0.6)
          Text(snap.currentStreak == 1 ? "day" : "days")
            .font(.system(size: 11, weight: .semibold))
        }
        .padding(.horizontal, 6)
        .widgetAccentable()
      }
      .widgetBackground(.clear)

    case .accessoryRectangular:
      VStack(alignment: .leading, spacing: 0) {
        AccessoryHeading(text: "STREAK", symbol: flame)
        Text(snap.currentStreak == 1 ? "1 day" : "\(snap.currentStreak) days")
          .font(.system(size: 20, weight: .bold, design: .rounded))
        ViewThatFits(in: .horizontal) {
          Text("best \(snap.bestStreak) · \(snap.monthPct)% this month")
          Text("best \(snap.bestStreak) · \(snap.monthPct)% of \(snap.monthName.prefix(3).capitalized)")
          Text("best \(snap.bestStreak) · \(snap.monthPct)%")
        }
        .font(.system(size: 12, weight: .medium))
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      .widgetAccentable()
      .widgetBackground(.clear)

    case .accessoryInline:
      // a symbol rather than an emoji, which the Lock Screen greys into a blob
      Label("\(snap.currentStreak)d streak · \(snap.monthPct)%", systemImage: flame)
        .widgetBackground(.clear)

    case .systemMedium:
      HStack(spacing: 16) {
        VStack(spacing: 0) {
          Text("\(snap.currentStreak)")
            .font(.system(size: 46, weight: .bold, design: .rounded))
            .foregroundColor(theme.done)
          Text(snap.currentStreak == 1 ? "DAY" : "DAYS")
            .font(.system(size: 9, weight: .bold))
            .kerning(1.6)
            .foregroundColor(theme.inkSoft)
        }
        VStack(alignment: .leading, spacing: 6) {
          WidgetHeading(text: "STREAK", theme: theme)
          StatLine(value: "\(snap.bestStreak)", label: "best this year", theme: theme)
          StatLine(value: "\(snap.perfectStreak)", label: "perfect days", theme: theme)
          HStack(spacing: 4) {
            ForEach(recentDays, id: \.day) { item in
              RoundedRectangle(cornerRadius: 2)
                .fill(item.done ? theme.done : theme.cellEmpty)
                .frame(width: 12, height: 12)
            }
          }
          Spacer(minLength: 0)
        }
      }
      .padding(14)
      .widgetBackground(theme.bg)

    default:
      VStack(spacing: 3) {
        Text("\(snap.currentStreak)")
          .font(.system(size: 48, weight: .bold, design: .rounded))
          .foregroundColor(theme.done)
        Text(snap.currentStreak == 1 ? "DAY STREAK" : "DAY STREAK")
          .font(.system(size: 9, weight: .bold))
          .kerning(1.4)
          .foregroundColor(theme.inkSoft)
        HStack(spacing: 3) {
          ForEach(recentDays, id: \.day) { item in
            RoundedRectangle(cornerRadius: 1.5)
              .fill(item.done ? theme.done : theme.cellEmpty)
              .frame(width: 9, height: 9)
          }
        }
        .padding(.top, 3)
        Text("best \(snap.bestStreak)")
          .font(.system(size: 9))
          .foregroundColor(theme.inkSoft)
      }
      .padding(10)
      .widgetBackground(theme.bg)
    }
  }
}

struct StreakWidget: Widget {
  private var families: [WidgetFamily] {
    if #available(iOS 16.0, *) {
      return [
        .systemSmall, .systemMedium,
        .accessoryCircular, .accessoryRectangular, .accessoryInline,
      ]
    }
    return [.systemSmall, .systemMedium]
  }

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "Streak", provider: SnapshotProvider()) { entry in
      StreakWidgetView(entry: entry)
    }
    .configurationDisplayName("Streak")
    .description("Consecutive days you've checked something off.")
    .supportedFamilies(families)
  }
}

// MARK: - Today's check

struct TodayWidgetView: View {
  var entry: SnapshotEntry
  @Environment(\.widgetFamily) private var family
  @Environment(\.colorScheme) private var scheme

  private var rows: [(name: String, state: Int)] {
    let snap = entry.snapshot
    guard let today = snap.today else { return [] }
    return snap.habits.enumerated().map { idx, habit in
      (habit.name.isEmpty ? "Unnamed habit" : habit.name, snap.state(day: today, habitIndex: idx))
    }
  }

  var body: some View {
    switch family {
    case .accessoryCircular, .accessoryRectangular, .accessoryInline:
      AccessoryToday(rows: rows, synced: entry.snapshot.today != nil)
    default:
      home
    }
  }

  @ViewBuilder private var home: some View {
    let theme = Theme.of(entry.snapshot, fallback: scheme)
    let rows = self.rows

    // as many rows as this widget has room for, rather than a fixed count per size
    ViewThatFits(in: .vertical) {
      ForEach(Array((0...rows.count).reversed()), id: \.self) { shown in
        list(rows, shown: shown, theme: theme)
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    // no padding of its own: the system's content margins are the only inset
    .widgetBackground(theme.bg)
  }

  private func list(_ rows: [(name: String, state: Int)], shown: Int, theme: Theme) -> some View {
    let doneToday = rows.filter { $0.state == 1 }.count

    return VStack(alignment: .leading, spacing: family == .systemSmall ? 5 : 7) {
      WidgetHeading(
        text: "TODAY",
        theme: theme,
        trailing: rows.isEmpty ? nil : "\(doneToday)/\(rows.count)"
      )

      if rows.isEmpty {
        Text(entry.snapshot.today == nil ? "Open the app to sync this month." : "No habits yet.")
          .font(.system(size: 11))
          .foregroundColor(theme.inkSoft)
      } else {
        ForEach(Array(rows.prefix(shown).enumerated()), id: \.offset) { _, row in
          HStack(spacing: 7) {
            StateGlyph(state: row.state, theme: theme)
            // the glyph already says "done"; a strikethrough on top of it is
            // redundant, and WidgetKit animates it in unevenly on reload
            Text(row.name)
              .font(.system(size: family == .systemSmall ? 11 : 12, weight: .medium))
              .foregroundColor(row.state == 1 ? theme.inkSoft : theme.ink)
              .lineLimit(1)
            Spacer(minLength: 0)
          }
        }
        if rows.count > shown {
          Text("+\(rows.count - shown) more")
            .font(.system(size: 9))
            .foregroundColor(theme.inkSoft)
        }
      }
    }
  }
}

/// Small check / cross / empty box mirroring the app's mark buttons.
struct StateGlyph: View {
  let state: Int
  let theme: Theme

  var body: some View {
    RoundedRectangle(cornerRadius: 4)
      .fill(state == 0 ? theme.cellEmpty : (state == 1 ? theme.done : theme.missed))
      .frame(width: 15, height: 15)
      .overlay(
        Group {
          if state == 1 {
            Image(systemName: "checkmark")
              .font(.system(size: 9, weight: .bold))
              .foregroundColor(theme.onState)
          } else if state == 2 {
            Image(systemName: "xmark")
              .font(.system(size: 9, weight: .bold))
              .foregroundColor(theme.onState)
          }
        }
      )
  }
}

/// Today's tally on the Lock Screen, and what is still open.
struct AccessoryToday: View {
  let rows: [(name: String, state: Int)]
  /// false when the snapshot isn't this month's, so there is no today to show
  let synced: Bool
  @Environment(\.widgetFamily) private var family

  var body: some View {
    let done = rows.filter { $0.state == 1 }.count
    let open = rows.filter { $0.state == 0 }.map(\.name)
    let blank = synced ? "No habits yet" : "Open Rin to sync"

    Group {
      switch family {
      case .accessoryCircular:
        ZStack {
          ProgressRing(
            progress: rows.isEmpty ? 0 : Double(done) / Double(rows.count),
            theme: .accessory,
            lineWidth: 6
          )
          VStack(spacing: -2) {
            Text(rows.isEmpty ? "–" : "\(done)/\(rows.count)")
              .font(.system(size: 17, weight: .bold, design: .rounded))
              .lineLimit(1)
              .minimumScaleFactor(0.6)
            Text("today").font(.system(size: 10, weight: .bold))
          }
          .padding(.horizontal, 9)
        }
        .padding(3)

      case .accessoryRectangular:
        VStack(alignment: .leading, spacing: 1) {
          AccessoryHeading(text: "TODAY", trailing: rows.isEmpty ? nil : "\(done)/\(rows.count)")
          if rows.isEmpty {
            Text(blank).font(.system(size: 13, weight: .medium))
          } else if open.isEmpty {
            Label("All done", systemImage: "checkmark.circle.fill")
              .font(.system(size: 13, weight: .semibold))
          } else {
            // three lines fit under the heading; past that the third counts the rest
            let shown = open.count > 3 ? 2 : open.count
            ForEach(0..<shown, id: \.self) { i in
              AccessoryRow(text: open[i], done: false)
            }
            if open.count > shown {
              Text("+\(open.count - shown) more").font(.system(size: 12, weight: .medium))
            }
          }
        }
        .frame(maxWidth: .infinity, alignment: .leading)

      default:
        Label(rows.isEmpty ? blank : "\(done) of \(rows.count) done today", systemImage: "checklist")
      }
    }
    .widgetAccentable()
    .widgetBackground(.clear)
  }
}

/// One line of a Lock Screen list: an open or filled circle, then the text.
struct AccessoryRow: View {
  let text: String
  let done: Bool

  var body: some View {
    HStack(spacing: 4) {
      Image(systemName: done ? "checkmark.circle.fill" : "circle")
        .font(.system(size: 11, weight: .semibold))
      Text(text)
        .font(.system(size: 13, weight: .medium))
        .lineLimit(1)
    }
  }
}

struct TodayWidget: Widget {
  private var families: [WidgetFamily] {
    if #available(iOS 16.0, *) {
      return [
        .systemSmall, .systemMedium, .systemLarge,
        .accessoryCircular, .accessoryRectangular, .accessoryInline,
      ]
    }
    return [.systemSmall, .systemMedium, .systemLarge]
  }

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "TodayCheck", provider: SnapshotProvider()) { entry in
      TodayWidgetView(entry: entry)
    }
    .configurationDisplayName("Today's Check")
    .description("What you've ticked off today, and what's still open.")
    .supportedFamilies(families)
  }
}

// MARK: - Key goals

struct GoalsWidgetView: View {
  var entry: SnapshotEntry
  @Environment(\.widgetFamily) private var family
  @Environment(\.colorScheme) private var scheme

  var body: some View {
    switch family {
    case .accessoryRectangular, .accessoryInline:
      AccessoryGoals(goals: entry.snapshot.goals)
    default:
      home
    }
  }

  @ViewBuilder private var home: some View {
    let theme = Theme.of(entry.snapshot, fallback: scheme)
    let snap = entry.snapshot
    let goals = snap.goals
    // Empty goals are not counted, matching the app's card: a box marked done
    // before anything was written in it is not a goal anyone finished.
    let doneCount = goals.filter { $0.done && !$0.text.isEmpty }.count

    VStack(alignment: .leading, spacing: 8) {
      WidgetHeading(
        text: "KEY GOALS",
        theme: theme,
        trailing: goals.isEmpty ? nil : "\(doneCount)/\(goals.count)"
      )

      if goals.allSatisfy({ $0.text.isEmpty }) {
        Text("Set this month's goals in the app.")
          .font(.system(size: 11))
          .foregroundColor(theme.inkSoft)
      } else {
        ForEach(Array(goals.enumerated()), id: \.offset) { _, goal in
          HStack(spacing: 8) {
            StateGlyph(state: goal.done ? 1 : 0, theme: theme)
            Text(goal.text.isEmpty ? "—" : goal.text)
              .font(.system(size: 13, weight: .semibold))
              .foregroundColor(goal.done ? theme.done : theme.ink)
              .strikethrough(goal.done, color: theme.inkSoft)
              .lineLimit(family == .systemLarge ? 2 : 1)
            Spacer(minLength: 0)
          }
        }
      }

      if family == .systemLarge {
        Spacer(minLength: 0)
        Divider().background(theme.line)
        HStack {
          StatLine(value: "\(snap.monthPct)%", label: "month done", theme: theme)
          Spacer()
          StatLine(value: "\(snap.currentStreak)", label: "day streak", theme: theme)
        }
      }
      Spacer(minLength: 0)
    }
    .padding(14)
    .widgetBackground(theme.bg)
  }
}

/// The month's goals on the Lock Screen, counted the way the Home Screen widget counts them.
struct AccessoryGoals: View {
  let goals: [PlannerSnapshot.Goal]
  @Environment(\.widgetFamily) private var family

  var body: some View {
    let written = goals.filter { !$0.text.isEmpty }
    let done = written.filter(\.done).count

    Group {
      if family == .accessoryInline {
        Label(
          written.isEmpty ? "No goals set" : "\(done) of \(goals.count) goals done",
          systemImage: "target"
        )
      } else {
        VStack(alignment: .leading, spacing: 1) {
          AccessoryHeading(text: "KEY GOALS", trailing: written.isEmpty ? nil : "\(done)/\(goals.count)")
          if written.isEmpty {
            Text("No goals set yet").font(.system(size: 13, weight: .medium))
          }
          ForEach(Array(written.prefix(3).enumerated()), id: \.offset) { _, goal in
            AccessoryRow(text: goal.text, done: goal.done)
          }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
      }
    }
    .widgetAccentable()
    .widgetBackground(.clear)
  }
}

struct GoalsWidget: Widget {
  private var families: [WidgetFamily] {
    if #available(iOS 16.0, *) {
      return [.systemMedium, .systemLarge, .accessoryRectangular, .accessoryInline]
    }
    return [.systemMedium, .systemLarge]
  }

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "KeyGoals", provider: SnapshotProvider()) { entry in
      GoalsWidgetView(entry: entry)
    }
    .configurationDisplayName("Key Goals")
    .description("This month's three goals and whether they're done.")
    .supportedFamilies(families)
  }
}
