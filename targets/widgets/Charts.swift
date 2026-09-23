import SwiftUI

/// One cell of the radial tracker: a wedge of an annulus.
/// Angles are degrees with 0 at 12 o'clock, increasing clockwise — the same
/// convention as RadialTracker.tsx.
struct AnnularSector: Shape {
  let innerRadius: CGFloat
  let outerRadius: CGFloat
  let startAngle: Double
  let endAngle: Double

  func path(in rect: CGRect) -> Path {
    let center = CGPoint(x: rect.midX, y: rect.midY)
    // SwiftUI's 0° is 3 o'clock, so rotate a quarter turn to put 0 at the top
    let start = Angle(degrees: startAngle - 90)
    let end = Angle(degrees: endAngle - 90)

    func point(_ radius: CGFloat, _ angle: Angle) -> CGPoint {
      CGPoint(
        x: center.x + radius * CGFloat(cos(angle.radians)),
        y: center.y + radius * CGFloat(sin(angle.radians))
      )
    }

    var path = Path()
    path.move(to: point(outerRadius, start))
    path.addArc(center: center, radius: outerRadius, startAngle: start, endAngle: end, clockwise: false)
    path.addLine(to: point(innerRadius, end))
    path.addArc(center: center, radius: innerRadius, startAngle: end, endAngle: start, clockwise: true)
    path.closeSubpath()
    return path
  }
}

/// The month-at-a-glance ring chart: one ring per habit, one wedge per day.
struct RadialChart: View {
  let snapshot: PlannerSnapshot
  let theme: Theme
  var minRings: Int = 4
  var showToday: Bool = true
  /// radius of the empty centre as a share of the chart's side
  var holeRatio: CGFloat = 0.17

  var body: some View {
    GeometryReader { geo in
      let side = min(geo.size.width, geo.size.height)
      // leave a sliver of room outside the rings for the today marker
      let outer = side / 2 - (showToday ? 5 : 1)
      let inner = side * holeRatio
      let rings = max(snapshot.habits.count, minRings)
      let ringWidth = (outer - inner) / CGFloat(rings)
      let days = max(snapshot.daysInMonth, 1)
      let sector = 360.0 / Double(days)
      let gap = min(1.4, sector * 0.09)

      ZStack {
        ForEach(0..<days, id: \.self) { dayIndex in
          ForEach(0..<rings, id: \.self) { ring in
            let r1 = inner + CGFloat(ring) * ringWidth
            let r2 = r1 + ringWidth - max(0.6, ringWidth * 0.12)
            let hasHabit = ring < snapshot.habits.count
            let state = hasHabit ? snapshot.state(day: dayIndex + 1, habitIndex: ring) : 0

            AnnularSector(
              innerRadius: r1,
              outerRadius: r2,
              startAngle: Double(dayIndex) * sector + gap / 2,
              endAngle: Double(dayIndex + 1) * sector - gap / 2
            )
            .fill(theme.stateColor(state))
          }
        }

        if showToday, let today = snapshot.today, today <= days {
          // a dot outside the rings, rather than a wedge across them — a stroked
          // wedge reads as a stray line cutting through the chart
          let mid = (Double(today) - 0.5) * sector - 90
          let rad = mid * .pi / 180
          Circle()
            .fill(theme.accent)
            .frame(width: 4, height: 4)
            .offset(
              x: (outer + 3) * CGFloat(cos(rad)),
              y: (outer + 3) * CGFloat(sin(rad))
            )
        }
      }
      .frame(width: geo.size.width, height: geo.size.height)
    }
    .aspectRatio(1, contentMode: .fit)
  }
}

/// GitHub-style contribution grid: columns are weeks, rows are Sun–Sat.
struct YearGrid: View {
  let snapshot: PlannerSnapshot
  let theme: Theme
  var cell: CGFloat = 7
  var gap: CGFloat = 2
  /// show only the last N weeks (medium widgets can't fit a full year legibly)
  var weekLimit: Int? = nil

  private struct Day {
    let month: Int
    let day: Int
  }

  private var startOffset: Int {
    var comps = DateComponents()
    comps.year = snapshot.year
    comps.month = 1
    comps.day = 1
    let date = Calendar.current.date(from: comps) ?? Date()
    return Calendar.current.component(.weekday, from: date) - 1
  }

  private var days: [Day] {
    var out: [Day] = []
    for m in 0..<12 {
      let len = snapshot.yearDone.indices.contains(m) ? snapshot.yearDone[m].count : 0
      for d in 1...max(len, 1) where len > 0 {
        out.append(Day(month: m, day: d))
      }
    }
    return out
  }

  private func level(_ day: Day) -> Color {
    guard snapshot.yearDone.indices.contains(day.month),
          snapshot.yearDone[day.month].indices.contains(day.day - 1)
    else { return theme.ghLevels[0] }

    let done = snapshot.yearDone[day.month][day.day - 1]
    let missed = snapshot.yearMissed.indices.contains(day.month)
      && snapshot.yearMissed[day.month].indices.contains(day.day - 1)
      ? snapshot.yearMissed[day.month][day.day - 1] : 0
    let habitCount = snapshot.yearHabitCounts.indices.contains(day.month)
      ? snapshot.yearHabitCounts[day.month] : 0

    if done > 0, habitCount > 0 {
      let ratio = Double(done) / Double(habitCount)
      let idx = ratio <= 0.25 ? 1 : ratio <= 0.5 ? 2 : ratio <= 0.75 ? 3 : 4
      return theme.ghLevels[idx]
    }
    if missed > 0 { return theme.missed.opacity(0.45) }
    return theme.ghLevels[0]
  }

  /// Flat day-of-year index of the snapshot's "today", if it has one.
  private var todayIndex: Int? {
    guard let today = snapshot.today else { return nil }
    var idx = 0
    for m in 0..<snapshot.month where snapshot.yearDone.indices.contains(m) {
      idx += snapshot.yearDone[m].count
    }
    return idx + today - 1
  }

  var body: some View {
    let all = days
    let totalCols = Int(ceil(Double(startOffset + all.count) / 7.0))
    // A window has to end at today, not at December — anchoring it to the end
    // of the year would show only empty future weeks for most of the year.
    let lastCol = todayIndex.map { ($0 + startOffset) / 7 } ?? (totalCols - 1)
    let firstCol = weekLimit.map { max(0, lastCol - $0 + 1) } ?? 0
    let endCol = weekLimit == nil ? totalCols : lastCol + 1

    HStack(alignment: .top, spacing: gap) {
      ForEach(firstCol..<endCol, id: \.self) { col in
        VStack(spacing: gap) {
          ForEach(0..<7, id: \.self) { row in
            let idx = col * 7 + row - startOffset
            if idx >= 0, idx < all.count {
              RoundedRectangle(cornerRadius: 1.5)
                .fill(level(all[idx]))
                .frame(width: cell, height: cell)
            } else {
              Color.clear.frame(width: cell, height: cell)
            }
          }
        }
      }
    }
  }
}

/// Progress ring used by the streak and progress widgets.
struct ProgressRing: View {
  let progress: Double
  let theme: Theme
  var lineWidth: CGFloat = 8

  var body: some View {
    ZStack {
      Circle()
        .stroke(theme.cellEmpty, lineWidth: lineWidth)
      Circle()
        .trim(from: 0, to: max(0.001, min(1, progress)))
        .stroke(theme.done, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
        .rotationEffect(.degrees(-90))
    }
  }
}

/// The section label used across the widgets — small caps with a leading bar.
struct WidgetHeading: View {
  let text: String
  let theme: Theme
  var trailing: String? = nil

  var body: some View {
    HStack(spacing: 5) {
      RoundedRectangle(cornerRadius: 1)
        .fill(theme.accent)
        .frame(width: 3, height: 10)
      Text(text)
        .font(.system(size: 9, weight: .bold))
        .kerning(1.4)
        .foregroundColor(theme.ink)
        .lineLimit(1)
      Spacer(minLength: 2)
      if let trailing {
        Text(trailing)
          .font(.system(size: 9, weight: .semibold))
          .foregroundColor(theme.inkSoft)
          .lineLimit(1)
      }
    }
  }
}
