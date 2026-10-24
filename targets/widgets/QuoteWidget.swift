import SwiftUI
import WidgetKit

/// One quote per day, picked from the list here so it rolls over at midnight without the app.
struct QuoteWidgetView: View {
  var entry: SnapshotEntry
  @Environment(\.widgetFamily) private var family
  @Environment(\.colorScheme) private var scheme
  @Environment(\.widgetContentMargins) private var margins

  private var fontSize: CGFloat {
    switch family {
    case .systemSmall: return 12
    case .systemLarge: return 20
    default: return 15
    }
  }

  var body: some View {
    let theme = Theme.of(entry.snapshot, fallback: scheme)
    let rotation = entry.snapshot.rotation(from: entry.date)
    let quote = rotation.first?.text
    let heading = rotation.first?.own == true ? "YOUR WORDS" : "DISCIPLINE"

    switch family {
    case .accessoryRectangular:
      let picks = Self.lockPicks(rotation)
      // never cut: a quote too long for the slot gives way to the next one that fits whole
      ViewThatFits(in: .vertical) {
        ForEach(Array(picks.enumerated()), id: \.offset) { _, pick in
          lockLines(pick.text, heading: pick.own ? "YOUR WORDS" : "DISCIPLINE")
          lockLines(pick.text, heading: nil)
        }
        // every quote is too long: the shortest, made small enough to show whole
        lockLines(picks.last?.text ?? "Keep going.", heading: nil).minimumScaleFactor(0.65)
      }
      // measured against the whole slot: the Lock Screen draws into its margin, and a quote needs the room
      .padding(.top, -margins.top)
      .padding(.bottom, -margins.bottom)
      .frame(maxWidth: .infinity, alignment: .leading)
      .widgetAccentable()
      .widgetBackground(.clear)

    default:
      VStack(alignment: .leading, spacing: family == .systemSmall ? 6 : 10) {
        WidgetHeading(text: "\(heading).", theme: theme)
        // a spacer either side centres a short quote
        if family == .systemLarge { Spacer(minLength: 0) }
        if let quote {
          Text("“\(quote)”")
            .font(.system(size: fontSize, weight: .medium))
            .italic()
            .foregroundColor(theme.ink)
            .lineSpacing(family == .systemLarge ? 5 : 3)
            // long quotes shrink rather than getting cut off mid-thought
            .minimumScaleFactor(0.6)
            // first claim on the room, but no more than there is, so a long custom quote shrinks
            .layoutPriority(1)
        } else {
          Text("Open the app to sync today's quote.")
            .font(.system(size: 12))
            .foregroundColor(theme.inkSoft)
        }
        Spacer(minLength: 0)
        if family == .systemLarge {
          TodayStrip(snapshot: entry.snapshot, theme: theme)
          YearProgress(snapshot: entry.snapshot, date: entry.date, theme: theme)
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(family == .systemSmall ? 12 : 16)
      .widgetBackground(theme.bg)
    }
  }

  private func lockLines(_ quote: String, heading: String?) -> some View {
    VStack(alignment: .leading, spacing: 1) {
      if let heading {
        Text(heading).font(.system(size: 11, weight: .bold)).kerning(1)
      }
      Text(quote).font(.system(size: 13, weight: .medium))
    }
  }

  /// The day's quote, the next few in the rotation, then the shortest of all as the one most likely to fit.
  static func lockPicks(_ rotation: [(text: String, own: Bool)]) -> [(text: String, own: Bool)] {
    guard let shortest = rotation.min(by: { $0.text.count < $1.text.count }) else {
      return [("Keep going.", false)]
    }
    return Array(rotation.prefix(10)) + [shortest]
  }
}

/// Today's tally and the last seven days, under the quote on the large widget.
struct TodayStrip: View {
  let snapshot: PlannerSnapshot
  let theme: Theme

  var body: some View {
    let today = snapshot.today
    let total = snapshot.habits.count
    let done = today.map { snapshot.doneCount(day: $0) } ?? 0

    VStack(alignment: .leading, spacing: 7) {
      Divider().background(theme.line)
      HStack(alignment: .center) {
        if total > 0 {
          Text(verbatim: "\(done)/\(total)")
            .font(.system(size: 15, weight: .bold))
            .foregroundColor(done == total ? theme.done : theme.ink)
          Text("done today")
            .font(.system(size: 11))
            .foregroundColor(theme.inkSoft)
        } else {
          Text("No habits yet")
            .font(.system(size: 11))
            .foregroundColor(theme.inkSoft)
        }
        Spacer()
        RecentPips(snapshot: snapshot, theme: theme, size: 11)
        Text(verbatim: "\(snapshot.currentStreak)d")
          .font(.system(size: 12, weight: .bold))
          .foregroundColor(theme.accent)
      }
    }
  }
}

/// How far through the calendar year we are, and the year's check-ins.
struct YearProgress: View {
  let snapshot: PlannerSnapshot
  let date: Date
  let theme: Theme

  var body: some View {
    let cal = Calendar.current
    let dayOfYear = cal.ordinality(of: .day, in: .year, for: date) ?? 1
    let daysInYear = cal.range(of: .day, in: .year, for: date)?.count ?? 365
    let fraction = min(1, max(0, Double(dayOfYear) / Double(daysInYear)))

    VStack(alignment: .leading, spacing: 7) {
      Divider().background(theme.line)
      HStack(alignment: .firstTextBaseline) {
        // verbatim: plain interpolation would localise it to "2,026"
        Text(verbatim: String(snapshot.year))
          .font(.system(size: 12, weight: .bold))
          .kerning(1.2)
          .foregroundColor(theme.ink)
        Spacer()
        Text(verbatim: "day \(dayOfYear) of \(daysInYear)")
          .font(.system(size: 11))
          .foregroundColor(theme.inkSoft)
      }
      PressureBar(fraction: fraction, tone: theme.accent, theme: theme, height: 6)
      HStack {
        Text("\(Int(fraction * 100))% through the year")
          .font(.system(size: 11))
          .foregroundColor(theme.inkSoft)
        Spacer()
        Text("\(snapshot.yearTotal) check-ins")
          .font(.system(size: 11, weight: .bold))
          .foregroundColor(theme.done)
      }
    }
  }
}

struct QuoteWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "DailyQuote", provider: SnapshotProvider()) { entry in
      QuoteWidgetView(entry: entry)
    }
    .configurationDisplayName("Daily Quote")
    .description("One quote a day, built-in or your own, changing at midnight.")
    .supportedFamilies([.systemSmall, .systemMedium, .systemLarge, .accessoryRectangular])
  }
}
