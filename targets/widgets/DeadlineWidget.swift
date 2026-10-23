import SwiftUI
import WidgetKit

/// Mirrors src/deadlines.ts. The app, the reminders and this widget all have to
/// agree about how close "close" is, so the bands and the window live in one
/// place on each side and are kept identical across them.
enum Deadline {
  static let hour: TimeInterval = 3600
  static let day: TimeInterval = 86_400

  /// The run-up over which a deadline goes from "someday" to "now"
  static let pressureWindow: TimeInterval = 7 * day

  enum Urgency {
    case overdue, now, soon, near, later
  }

  static func urgency(of due: Date, at moment: Date) -> Urgency {
    let left = due.timeIntervalSince(moment)
    if left <= 0 { return .overdue }
    if left <= hour { return .now }
    if left <= day { return .soon }
    if left <= 3 * day { return .near }
    return .later
  }

  static func colour(_ u: Urgency, _ theme: Theme) -> Color {
    switch u {
    case .overdue, .now: return theme.missed
    case .soon, .near: return theme.accent
    case .later: return theme.inkSoft
    }
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

  static func dueLabel(_ due: Date, at moment: Date) -> String {
    let cal = Calendar.current
    let time = due.formatted(.dateTime.hour(.twoDigits(amPM: .omitted)).minute())
    if cal.isDateInToday(due) { return "Today · \(time)" }
    if cal.isDateInTomorrow(due) { return "Tomorrow · \(time)" }
    if cal.isDateInYesterday(due) { return "Yesterday · \(time)" }
    let date = due.formatted(.dateTime.weekday(.abbreviated).day().month(.abbreviated))
    return "\(date) · \(time)"
  }

  /// When the nearest deadline next changes band, so the timeline can refresh
  /// exactly then rather than waking hourly on the off-chance.
  static func nextBoundary(after moment: Date, in snapshot: PlannerSnapshot) -> Date? {
    let leads: [TimeInterval] = [3 * day, day, 3 * hour, hour, 0]
    return snapshot.deadlines
      .flatMap { task in leads.map { task.date.addingTimeInterval(-$0) } }
      .filter { $0 > moment }
      .min()
  }

  /// Every moment one of the shown countdowns changes its wording, soonest
  /// first.
  ///
  /// A widget that only reloaded at the urgency bands would sit on "5d left"
  /// for two days before jumping to "3d left". Entries are cheap where reloads
  /// are budgeted, so the timeline carries one per step instead: whole days out
  /// while the label is in days, whole hours once it is in hours.
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

/// The bar that fills over the last week. Same job as the one in the app: give
/// the pressure a reading between the colour bands, and give it to people who
/// can't tell the red from the green.
struct PressureBar: View {
  var fraction: Double
  var tone: Color
  var theme: Theme

  var body: some View {
    GeometryReader { geo in
      ZStack(alignment: .leading) {
        Capsule().fill(theme.cellEmpty)
        Capsule()
          .fill(tone)
          .frame(width: max(2, geo.size.width * min(max(fraction, 0), 1)))
      }
    }
    .frame(height: 3)
  }
}

struct DeadlineRow: View {
  var item: PlannerSnapshot.Task
  var now: Date
  var theme: Theme
  var compact: Bool

  var body: some View {
    let tone = Deadline.colour(Deadline.urgency(of: item.date, at: now), theme)

    VStack(alignment: .leading, spacing: 3) {
      HStack(alignment: .firstTextBaseline, spacing: 6) {
        Text(item.text.isEmpty ? "Untitled task" : item.text)
          .font(.system(size: compact ? 12 : 13, weight: .semibold))
          .foregroundColor(theme.ink)
          .lineLimit(1)
        Spacer(minLength: 4)
        Text(Deadline.timeLeft(item.date, at: now))
          .font(.system(size: compact ? 10 : 11, weight: .bold))
          .foregroundColor(tone)
          .lineLimit(1)
          .fixedSize()
      }
      if !compact {
        Text(Deadline.dueLabel(item.date, at: now))
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
          // One deadline, read from across the room: the time left is the
          // headline and everything else is a caption under it.
          let tone = Deadline.colour(Deadline.urgency(of: next.date, at: now), theme)
          Text(Deadline.timeLeft(next.date, at: now))
            .font(.system(size: 22, weight: .bold))
            .foregroundColor(tone)
            .lineLimit(1)
            .minimumScaleFactor(0.6)
          Text(next.text.isEmpty ? "Untitled task" : next.text)
            .font(.system(size: 12, weight: .semibold))
            .foregroundColor(theme.ink)
            .lineLimit(2)
          Text(Deadline.dueLabel(next.date, at: now))
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

/// Lock Screen. Rendered in the system's own monochrome tint, so it carries no
/// colour of its own — the words have to do all the work.
struct AccessoryDeadline: View {
  var item: PlannerSnapshot.Task?
  var now: Date

  var body: some View {
    VStack(alignment: .leading, spacing: 1) {
      Text("NEXT DUE")
        .font(.system(size: 12, weight: .bold))
      if let item {
        Text(item.text.isEmpty ? "Untitled task" : item.text)
          .font(.system(size: 14, weight: .semibold))
          .lineLimit(1)
        Text(Deadline.timeLeft(item.date, at: now))
          .font(.system(size: 13, weight: .medium))
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
        let title = item.text.isEmpty ? "Untitled task" : item.text
        Label(
          "\(Deadline.timeLeft(item.date, at: now)) · \(title)",
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
  private var families: [WidgetFamily] {
    if #available(iOS 16.0, *) {
      return [.systemSmall, .systemMedium, .systemLarge, .accessoryRectangular, .accessoryInline]
    }
    return [.systemSmall, .systemMedium, .systemLarge]
  }

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "Deadlines", provider: SnapshotProvider()) { entry in
      DeadlineWidgetView(entry: entry)
    }
    .configurationDisplayName("Deadlines")
    .description("Tasks with a date on them, closest first.")
    .supportedFamilies(families)
  }
}
