import SwiftUI
import WidgetKit

/// One quote per day, rotating at midnight.
///
/// The widget picks from the list itself rather than being handed today's quote,
/// so it rolls over on its own even if the app is never opened — `SnapshotProvider`
/// already refreshes the timeline just after midnight.
struct QuoteWidgetView: View {
  var entry: SnapshotEntry
  @Environment(\.widgetFamily) private var family
  @Environment(\.colorScheme) private var scheme

  private var fontSize: CGFloat {
    switch family {
    case .systemSmall: return 12
    case .systemLarge: return 20
    default: return 15
    }
  }

  var body: some View {
    let theme = Theme.of(entry.snapshot, fallback: scheme)
    let quote = entry.snapshot.quote(on: entry.date)

    switch family {
    case .accessoryRectangular:
      let full = quote ?? "Keep going."
      let lead = Self.firstSentence(full)
      // a long quote gives up the heading, then everything after its first sentence
      ViewThatFits(in: .vertical) {
        lockLines(full, heading: true)
        lockLines(full, heading: false)
        lockLines(lead, heading: true)
        lockLines(lead, heading: false).lineLimit(4).minimumScaleFactor(0.9)
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      .widgetAccentable()
      .widgetBackground(.clear)

    default:
      VStack(alignment: .leading, spacing: family == .systemSmall ? 6 : 10) {
        WidgetHeading(text: "DISCIPLINE.", theme: theme)
        // short quotes would otherwise pool all the slack under the text;
        // a spacer either side centres them in whatever room is left
        if family == .systemLarge { Spacer(minLength: 0) }
        if let quote {
          Text("“\(quote)”")
            .font(.system(size: fontSize, weight: .medium))
            .italic()
            .foregroundColor(theme.ink)
            .lineSpacing(family == .systemLarge ? 5 : 3)
            // long quotes shrink rather than getting cut off mid-thought
            .minimumScaleFactor(0.6)
            .fixedSize(horizontal: false, vertical: true)
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

  private func lockLines(_ quote: String, heading: Bool) -> some View {
    VStack(alignment: .leading, spacing: 1) {
      if heading {
        Text("DISCIPLINE").font(.system(size: 11, weight: .bold)).kerning(1)
      }
      Text(quote).font(.system(size: 13, weight: .medium))
    }
  }

  /// "One. Two." → "One." A quote's opening sentence reads whole on its own.
  static func firstSentence(_ quote: String) -> String {
    guard let end = quote.range(of: ". ") else { return quote }
    return String(quote[..<end.lowerBound]) + "."
  }
}

/// Today at a glance — the last seven days as pips, plus where today stands.
/// Sits between the quote and the year bar so the large widget has no dead space.
struct TodayStrip: View {
  let snapshot: PlannerSnapshot
  let theme: Theme

  private var recent: [(day: Int, done: Bool)] {
    guard let today = snapshot.today else { return [] }
    return (max(1, today - 6)...today).map { ($0, snapshot.doneCount(day: $0) > 0) }
  }

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
        HStack(spacing: 4) {
          ForEach(recent, id: \.day) { item in
            RoundedRectangle(cornerRadius: 2)
              .fill(item.done ? theme.done : theme.cellEmpty)
              .frame(width: 11, height: 11)
          }
        }
        Text(verbatim: "\(snapshot.currentStreak)d")
          .font(.system(size: 12, weight: .bold))
          .foregroundColor(theme.accent)
      }
    }
  }
}

/// How far through the calendar year we are, plus what you've banked in it.
/// Fills the space a quote leaves empty on the large widget.
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
      GeometryReader { geo in
        ZStack(alignment: .leading) {
          Capsule().fill(theme.cellEmpty)
          Capsule()
            .fill(theme.accent)
            .frame(width: max(2, geo.size.width * fraction))
        }
      }
      .frame(height: 6)
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
  private var families: [WidgetFamily] {
    if #available(iOS 16.0, *) {
      return [.systemSmall, .systemMedium, .systemLarge, .accessoryRectangular]
    }
    return [.systemSmall, .systemMedium, .systemLarge]
  }

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "DailyQuote", provider: SnapshotProvider()) { entry in
      QuoteWidgetView(entry: entry)
    }
    .configurationDisplayName("Daily Quote")
    .description("One discipline quote a day, changing at midnight.")
    .supportedFamilies(families)
  }
}
