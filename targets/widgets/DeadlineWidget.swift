import SwiftUI
import WidgetKit

/// Mirrors src/deadlines.ts and the Android widget; the bands must match across all three.
enum Deadline {
  static let hour: TimeInterval = 3600
  static let day: TimeInterval = 86_400

  /// The run-up over which a deadline goes from "someday" to "now"
  static let pressureWindow: TimeInterval = 7 * day

  static func colour(of due: Date, at moment: Date, _ theme: Theme) -> Color {
    let left = due.timeIntervalSince(moment)
    if left <= hour { return theme.missed }
    if left <= 3 * day { return theme.accent }
    return theme.inkSoft
  }

  /// 0 a week or more out, 1 at the deadline and past it
  static func pressure(of due: Date, at moment: Date) -> Double {
    let left = due.timeIntervalSince(moment)
    if left <= 0 { return 1 }
    if left >= pressureWindow { return 0 }
    return 1 - left / pressureWindow
  }

  /// Largest unit only — "3d", "5h", "12m" — matching `coarse` in the app.
  static func coarse(_ interval: TimeInterval) -> String {
    if interval >= day { return "\(Int(interval / day))d" }
    if interval >= hour { return "\(Int(interval / hour))h" }
    if interval >= 60 { return "\(Int(interval / 60))m" }
    return "now"
  }

  static func timeLeft(_ due: Date, at moment: Date) -> String {
    let left = due.timeIntervalSince(moment)
    if left <= 0 {
      let over = coarse(-left)
      return over == "now" ? "just overdue" : "\(over) overdue"
    }
    let rem = coarse(left)
    return rem == "now" ? "due any moment" : "\(rem) left"
  }

  /// The date line, with the series named on a recurring deadline
  static func dueLine(_ item: PlannerSnapshot.Task, at moment: Date) -> String {
    dueLabel(item.date, at: moment) + (item.repeats.map { " · \($0)" } ?? "")
  }

  static func dueLabel(_ due: Date, at moment: Date) -> String {
    let cal = Calendar.current
    // Always 24-hour, like the app and the Android widget
    let hm = cal.dateComponents([.hour, .minute], from: due)
    let time = String(format: "%02d:%02d", hm.hour ?? 0, hm.minute ?? 0)
    if cal.isDateInToday(due) { return "Today · \(time)" }
    if cal.isDateInTomorrow(due) { return "Tomorrow · \(time)" }
    if cal.isDateInYesterday(due) { return "Yesterday · \(time)" }
    let date = due.formatted(.dateTime.weekday(.abbreviated).day().month(.abbreviated))
    return "\(date) · \(time)"
  }

  /// Every moment one of the shown countdowns changes its wording, soonest first.
  static func labelChanges(
    after moment: Date,
    in snapshot: PlannerSnapshot,
    limit: Int
  ) -> [Date] {
    var moments: Set<Date> = []
    for task in snapshot.deadlines.prefix(6) {
      for k in 1...14 { moments.insert(task.date.addingTimeInterval(-Double(k) * day)) }
      for k in 1...24 { moments.insert(task.date.addingTimeInterval(-Double(k) * hour)) }
      moments.insert(task.date)
    }
    return Array(moments.filter { $0 > moment }.sorted().prefix(limit))
  }
}

// MARK: - Deadlines

/// A filled capsule; on deadlines it fills over the last week, as in the app.
struct PressureBar: View {
  var fraction: Double
  var tone: Color
  var theme: Theme
  var height: CGFloat = 3

  var body: some View {
    GeometryReader { geo in
      ZStack(alignment: .leading) {
        Capsule().fill(theme.cellEmpty)
        Capsule()
          .fill(tone)
          .frame(width: max(2, geo.size.width * min(max(fraction, 0), 1)))
      }
    }
    .frame(height: height)
  }
}

struct DeadlineRow: View {
  var item: PlannerSnapshot.Task
  var now: Date
  var theme: Theme
  var compact: Bool

  var body: some View {
    let tone = Deadline.colour(of: item.date, at: now, theme)

    VStack(alignment: .leading, spacing: 3) {
      HStack(alignment: .firstTextBaseline, spacing: 6) {
        Text(item.title)
          .font(.system(size: compact ? 12 : 13, weight: .semibold))
          .foregroundColor(theme.ink)
          .lineLimit(1)
        // without the date line, a mark after the title is all that says it repeats
        if compact, item.repeats != nil {
          Image(systemName: "arrow.clockwise")
            .font(.system(size: 9, weight: .semibold))
            .foregroundColor(theme.inkSoft)
        }
        Spacer(minLength: 4)
        Text(Deadline.timeLeft(item.date, at: now))
          .font(.system(size: compact ? 10 : 11, weight: .bold))
          .foregroundColor(tone)
          .lineLimit(1)
          .fixedSize()
      }
      if !compact {
        Text(Deadline.dueLine(item, at: now))
          .font(.system(size: 10))
          .foregroundColor(theme.inkSoft)
      }
      PressureBar(
        fraction: Deadline.pressure(of: item.date, at: now),
        tone: tone,
        theme: theme
      )
    }
  }
}

struct DeadlineWidgetView: View {
  var entry: SnapshotEntry
  @Environment(\.widgetFamily) private var family
  @Environment(\.colorScheme) private var scheme

  private var limit: Int {
    switch family {
    case .systemLarge: return 6
    case .systemMedium: return 3
    default: return 1
    }
  }

  var body: some View {
    let theme = Theme.of(entry.snapshot, fallback: scheme)
    let now = entry.date
    let tasks = entry.snapshot.deadlines

    switch family {
    case .accessoryRectangular:
      AccessoryDeadline(item: tasks.first, now: now)
    case .accessoryInline:
      InlineDeadline(item: tasks.first, now: now)
    default:
      VStack(alignment: .leading, spacing: family == .systemSmall ? 6 : 9) {
        WidgetHeading(
          text: "DEADLINES",
          theme: theme,
          trailing: tasks.isEmpty ? nil : "\(tasks.count)"
        )

        if tasks.isEmpty {
          Text("Nothing due. Add a deadline in the app.")
            .font(.system(size: 11))
            .foregroundColor(theme.inkSoft)
        } else if family == .systemSmall, let next = tasks.first {
          // one deadline, with the time left as the headline
          let tone = Deadline.colour(of: next.date, at: now, theme)
          Text(Deadline.timeLeft(next.date, at: now))
            .font(.system(size: 22, weight: .bold))
            .foregroundColor(tone)
            .lineLimit(1)
            .minimumScaleFactor(0.6)
          Text(next.title)
            .font(.system(size: 12, weight: .semibold))
            .foregroundColor(theme.ink)
            .lineLimit(2)
          Text(Deadline.dueLine(next, at: now))
            .font(.system(size: 10))
            .foregroundColor(theme.inkSoft)
            .lineLimit(1)
          Spacer(minLength: 0)
          PressureBar(
            fraction: Deadline.pressure(of: next.date, at: now),
            tone: tone,
            theme: theme
          )
        } else {
          ForEach(Array(tasks.prefix(limit).enumerated()), id: \.offset) { _, task in
            DeadlineRow(item: task, now: now, theme: theme, compact: family == .systemMedium)
          }
          if tasks.count > limit {
            Text("+\(tasks.count - limit) more")
              .font(.system(size: 10))
              .foregroundColor(theme.inkSoft)
          }
        }
        Spacer(minLength: 0)
      }
      .padding(14)
      .widgetBackground(theme.bg)
    }
  }
}

/// Lock Screen, in the system's monochrome tint, so the words carry it.
struct AccessoryDeadline: View {
  var item: PlannerSnapshot.Task?
  var now: Date

  var body: some View {
    VStack(alignment: .leading, spacing: 1) {
      AccessoryHeading(text: "NEXT DUE")
      if let item {
        Text(item.title)
          .font(.system(size: 14, weight: .semibold))
          .lineLimit(1)
        Text(Deadline.timeLeft(item.date, at: now) + (item.repeats.map { " · \($0)" } ?? ""))
          .font(.system(size: 13, weight: .medium))
          .lineLimit(1)
      } else {
        Text("Nothing due")
          .font(.system(size: 14, weight: .semibold))
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .widgetBackground(.clear)
  }
}

/// The line above the clock. Countdown first, since the system cuts the end off a long one.
struct InlineDeadline: View {
  var item: PlannerSnapshot.Task?
  var now: Date

  var body: some View {
    Group {
      if let item {
        Label(
          "\(Deadline.timeLeft(item.date, at: now)) · \(item.title)",
          systemImage: item.date <= now ? "exclamationmark.circle" : "hourglass"
        )
      } else {
        Label("Nothing due", systemImage: "checkmark.circle")
      }
    }
    .widgetBackground(.clear)
  }
}

struct DeadlineWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "Deadlines", provider: SnapshotProvider()) { entry in
      DeadlineWidgetView(entry: entry)
    }
    .configurationDisplayName("Deadlines")
    .description("Tasks with a date on them, closest first.")
    .supportedFamilies([.systemSmall, .systemMedium, .systemLarge, .accessoryRectangular, .accessoryInline])
  }
}
