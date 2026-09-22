import SwiftUI

extension Color {
  init(hex: UInt32) {
    self.init(
      .sRGB,
      red: Double((hex >> 16) & 0xFF) / 255,
      green: Double((hex >> 8) & 0xFF) / 255,
      blue: Double(hex & 0xFF) / 255,
      opacity: 1
    )
  }
}

/// Mirrors src/theme.ts. Brand colours, the shades derived from them, and the
/// two state colours (green / red) that are the deliberate exception.
enum Brand {
  static let charcoal = Color(hex: 0x4A4A4A)
  static let grey = Color(hex: 0xCBCBCB)
  static let ivory = Color(hex: 0xFFFFE3)
  static let slate = Color(hex: 0x6D8196)
}

struct Theme {
  let bg: Color
  let card: Color
  let ink: Color
  let inkSoft: Color
  let line: Color
  let accent: Color
  let cellEmpty: Color
  let done: Color
  let missed: Color
  let onState: Color
  /// ramp for the year grid, index 0 = empty
  let ghLevels: [Color]

  static let dark = Theme(
    bg: Color(hex: 0x242424),
    card: Color(hex: 0x313131),
    ink: Brand.ivory,
    inkSoft: Brand.grey,
    line: Color(hex: 0x5A5A5A),
    accent: Color(hex: 0x8FA5BA),
    cellEmpty: Color(hex: 0x2E2E2E),
    done: Color(hex: 0x93C63F),
    missed: Color(hex: 0xEF4C63),
    onState: Color(hex: 0x242424),
    // index 0 and 1 lifted to clear the card they sit on — see the note in
    // src/theme.ts. The widget's card is opaque 0x313131 rather than the app's
    // translucent one, but it lands in the same place, so the fault was the same.
    ghLevels: [
      Color(hex: 0x404040), Color(hex: 0x386021), Color(hex: 0x497B2D),
      Color(hex: 0x6DA939), Color(hex: 0x93C63F),
    ]
  )

  static let light = Theme(
    bg: Brand.ivory,
    card: Color(hex: 0xFFFFFA),
    ink: Brand.charcoal,
    inkSoft: Color(hex: 0x5F6B78),
    line: Brand.grey,
    accent: Color(hex: 0x57697C),
    cellEmpty: Color(hex: 0xE5E5D5),
    done: Color(hex: 0x7FB32E),
    missed: Color(hex: 0xE5405A),
    onState: Color(hex: 0x2E2E2E),
    ghLevels: [
      Color(hex: 0xE5E5D5), Color(hex: 0xD9ECB2), Color(hex: 0xB7DC7A),
      Color(hex: 0x9CCD4D), Color(hex: 0x7FB32E),
    ]
  )

  /// Widgets follow the app's own appearance setting, not the phone's — the
  /// planner is the thing they are an extension of, so a light app next to a
  /// dark widget would read as a bug.
  ///
  /// `scheme` is only the fallback, for a snapshot written before the app
  /// started sending its theme, or the gallery preview which has no app
  /// setting to follow.
  static func of(_ snapshot: PlannerSnapshot, fallback scheme: ColorScheme) -> Theme {
    switch snapshot.theme {
    case "dark": return .dark
    case "light": return .light
    default: return scheme == .dark ? .dark : .light
    }
  }

  func stateColor(_ state: Int) -> Color {
    switch state {
    case 1: return done
    case 2: return missed
    default: return cellEmpty
    }
  }
}
