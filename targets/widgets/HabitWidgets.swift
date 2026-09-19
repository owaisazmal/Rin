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

  var body: some View {
    let theme = Theme.of(entry.snapshot, fallback: scheme)
    let snap = entry.snapshot

    switch family {
    case .accessoryCircular:
      ZStack {
        AccessoryWidgetBackground()
        VStack(spacing: -2) {
          Text("\(snap.currentStreak)")
            .font(.system(size: 22, weight: .bold, design: .rounded))
          Text("days").font(.system(size: 9))
        }
      }
      .widgetAccentable()

    case .accessoryRectangular:
      VStack(alignment: .leading, spacing: 1) {
        Text("STREAK").font(.system(size: 10, weight: .bold)).kerning(1)
        Text("\(snap.currentStreak) days")
          .font(.system(size: 18, weight: .bold, design: .rounded))
        Text("best \(snap.bestStreak) · \(snap.monthPct)% this month")
          .font(.system(size: 10))
      }
      .widgetAccentable()

    case .accessoryInline:
      Text("🔥 \(snap.currentStreak)d streak · \(snap.monthPct)%")

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

  private var limit: Int {
    switch family {
    case .systemSmall: return 3
    case .systemMedium: return 4
    default: return 8
    }
  }

  var body: some View {
    let theme = Theme.of(entry.snapshot, fallback: scheme)
    let snap = entry.snapshot
    let visible = Array(rows.prefix(limit))
    let doneToday = rows.filter { $0.state == 1 }.count

    VStack(alignment: .leading, spacing: family == .systemSmall ? 5 : 7) {
      WidgetHeading(
        text: "TODAY",
        theme: theme,
        trailing: rows.isEmpty ? nil : "\(doneToday)/\(rows.count)"
      )

      if rows.isEmpty {
        Text(snap.today == nil ? "Open the app to sync this month." : "No habits yet.")
          .font(.system(size: 11))
          .foregroundColor(theme.inkSoft)
      } else {
        ForEach(Array(visible.enumerated()), id: \.offset) { _, row in
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
        if rows.count > visible.count {
          Text("+\(rows.count - visible.count) more")
            .font(.system(size: 9))
            .foregroundColor(theme.inkSoft)
        }
      }
      Spacer(minLength: 0)
    }
    .padding(family == .systemSmall ? 11 : 14)
    .widgetBackground(theme.bg)
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

struct TodayWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "TodayCheck", provider: SnapshotProvider()) { entry in
      TodayWidgetView(entry: entry)
    }
    .configurationDisplayName("Today's Check")
    .description("What you've ticked off today, and what's still open.")
    .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
  }
}

// MARK: - Key goals

struct GoalsWidgetView: View {
  var entry: SnapshotEntry
  @Environment(\.widgetFamily) private var family
  @Environment(\.colorScheme) private var scheme

  var body: some View {
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

struct GoalsWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "KeyGoals", provider: SnapshotProvider()) { entry in
      GoalsWidgetView(entry: entry)
    }
    .configurationDisplayName("Key Goals")
    .description("This month's three goals and whether they're done.")
    .supportedFamilies([.systemMedium, .systemLarge])
  }
}
