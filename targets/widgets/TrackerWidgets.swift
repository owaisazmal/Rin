import SwiftUI
import WidgetKit

extension View {
  /// iOS 17 requires widgets to declare their background this way; older
  /// versions just take a plain background.
  @ViewBuilder
  func widgetBackground(_ color: Color) -> some View {
    if #available(iOS 17.0, *) {
      containerBackground(color, for: .widget)
    } else {
      background(color)
    }
  }
}

// MARK: - Radial tracker

struct RadialWidgetView: View {
  var entry: SnapshotEntry
  @Environment(\.widgetFamily) private var family
  @Environment(\.colorScheme) private var scheme

  var body: some View {
    let theme = Theme.of(entry.snapshot, fallback: scheme)
    let snap = entry.snapshot

    Group {
      switch family {
      case .systemSmall:
        // the count sits in the hole, so the rings can take the whole square
        ZStack {
          RadialChart(snapshot: snap, theme: theme, holeRatio: 0.22)
          Text("\(snap.monthDone)/\(snap.monthTotal)")
            .font(.system(size: 11, weight: .semibold))
            .foregroundColor(theme.inkSoft)
            .lineLimit(1)
            .minimumScaleFactor(0.7)
        }

      case .systemMedium:
        HStack(spacing: 14) {
          RadialChart(snapshot: snap, theme: theme)
          VStack(alignment: .leading, spacing: 6) {
            WidgetHeading(text: snap.monthName, theme: theme, trailing: "\(snap.year)")
            StatLine(value: "\(snap.monthPct)%", label: "of the month done", theme: theme)
            StatLine(value: "\(snap.currentStreak)", label: "day streak", theme: theme)
            StatLine(value: "\(snap.habits.count)", label: "habits tracked", theme: theme)
            Spacer(minLength: 0)
          }
        }

      default:
        VStack(spacing: 10) {
          WidgetHeading(text: snap.monthName, theme: theme, trailing: "\(snap.monthPct)%")
          RadialChart(snapshot: snap, theme: theme, minRings: 6)
          HStack(spacing: 14) {
            LegendDot(color: theme.done, label: "done", theme: theme)
            LegendDot(color: theme.missed, label: "missed", theme: theme)
            LegendDot(color: theme.cellEmpty, label: "pending", theme: theme)
            Spacer(minLength: 0)
            Text("\(snap.currentStreak)d streak")
              .font(.system(size: 10, weight: .bold))
              .foregroundColor(theme.accent)
          }
        }
      }
    }
    .padding(family == .systemSmall ? 10 : 14)
    .widgetBackground(theme.bg)
  }
}

struct StatLine: View {
  let value: String
  let label: String
  let theme: Theme

  var body: some View {
    HStack(alignment: .firstTextBaseline, spacing: 4) {
      Text(value)
        .font(.system(size: 15, weight: .bold))
        .foregroundColor(theme.ink)
      Text(label)
        .font(.system(size: 10))
        .foregroundColor(theme.inkSoft)
        .lineLimit(1)
    }
  }
}

struct LegendDot: View {
  let color: Color
  let label: String
  let theme: Theme

  var body: some View {
    HStack(spacing: 3) {
      RoundedRectangle(cornerRadius: 2).fill(color).frame(width: 8, height: 8)
      Text(label)
        .font(.system(size: 9))
        .foregroundColor(theme.inkSoft)
    }
  }
}

struct RadialTrackerWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "RadialTracker", provider: SnapshotProvider()) { entry in
      RadialWidgetView(entry: entry)
    }
    .configurationDisplayName("Radial Tracker")
    .description("This month as rings — one ring per habit, one wedge per day.")
    .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    // the view pads itself; the system's own margins on top left the rings
    // at barely half the square
    .contentMarginsDisabled()
  }
}

// MARK: - Year tracker

/// Medium only. A full year needs ~53 columns, which at a large widget's width
/// forces cells down to ~5pt — a stripe of confetti with most of the card empty.
/// The recent stretch at a legible size says more.
struct YearWidgetView: View {
  var entry: SnapshotEntry
  @Environment(\.colorScheme) private var scheme

  var body: some View {
    let theme = Theme.of(entry.snapshot, fallback: scheme)
    let snap = entry.snapshot

    VStack(alignment: .leading, spacing: 8) {
      WidgetHeading(
        text: "\(snap.year)",
        theme: theme,
        trailing: "\(snap.yearTotal) check-ins"
      )
      YearGrid(snapshot: snap, theme: theme, cell: 8, gap: 2, weekLimit: 17)
        .frame(maxWidth: .infinity, alignment: .trailing)
      HStack {
        Text("last 17 weeks")
          .font(.system(size: 9))
          .foregroundColor(theme.inkSoft)
        Spacer()
        Text("\(snap.currentStreak)d streak")
          .font(.system(size: 10, weight: .bold))
          .foregroundColor(theme.accent)
      }
    }
    .padding(14)
    .widgetBackground(theme.bg)
  }
}

struct YearTrackerWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "YearTracker", provider: SnapshotProvider()) { entry in
      YearWidgetView(entry: entry)
    }
    .configurationDisplayName("Year Tracker")
    .description("The last 17 weeks, shaded by how much you checked off.")
    .supportedFamilies([.systemMedium])
  }
}

// MARK: - Month progress

struct ProgressWidgetView: View {
  var entry: SnapshotEntry
  @Environment(\.widgetFamily) private var family
  @Environment(\.colorScheme) private var scheme

  var body: some View {
    let theme = Theme.of(entry.snapshot, fallback: scheme)
    let snap = entry.snapshot
    let progress = snap.monthTotal > 0 ? Double(snap.monthDone) / Double(snap.monthTotal) : 0

    Group {
      if family == .systemSmall {
        VStack(spacing: 8) {
          ZStack {
            ProgressRing(progress: progress, theme: theme, lineWidth: 9)
            VStack(spacing: 0) {
              Text("\(snap.monthPct)")
                .font(.system(size: 26, weight: .bold, design: .rounded))
                .foregroundColor(theme.ink)
              Text("%")
                .font(.system(size: 10, weight: .bold))
                .foregroundColor(theme.inkSoft)
            }
          }
          Text(snap.monthName)
            .font(.system(size: 9, weight: .bold))
            .kerning(1.2)
            .foregroundColor(theme.inkSoft)
            .lineLimit(1)
        }
      } else {
        HStack(spacing: 16) {
          ZStack {
            ProgressRing(progress: progress, theme: theme, lineWidth: 10)
            Text("\(snap.monthPct)%")
              .font(.system(size: 18, weight: .bold, design: .rounded))
              .foregroundColor(theme.ink)
          }
          .frame(width: 78, height: 78)

          VStack(alignment: .leading, spacing: 6) {
            WidgetHeading(text: snap.monthName, theme: theme)
            StatLine(value: "\(snap.monthDone)", label: "checked off", theme: theme)
            StatLine(value: "\(snap.monthMissed)", label: "missed", theme: theme)
            StatLine(value: "\(snap.currentStreak)", label: "day streak", theme: theme)
            Spacer(minLength: 0)
          }
        }
      }
    }
    .padding(14)
    .widgetBackground(theme.bg)
  }
}

struct MonthProgressWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "MonthProgress", provider: SnapshotProvider()) { entry in
      ProgressWidgetView(entry: entry)
    }
    .configurationDisplayName("Month Progress")
    .description("How much of this month you've actually checked off.")
    .supportedFamilies([.systemSmall, .systemMedium])
  }
}
