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

/// Mirrors src/theme.ts.
struct Theme {
  let bg: Color
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
    bg: Color(hex: 0x0D0D0D),
    ink: Color(hex: 0xFFFFE3),
    inkSoft: Color(hex: 0xCBCBCB),
    line: Color(hex: 0x4A4A4A),
    accent: Color(hex: 0x8FA5BA),
    cellEmpty: Color(hex: 0x1A1A1A),
    done: Color(hex: 0x93C63F),
    missed: Color(hex: 0xEF4C63),
    onState: Color(hex: 0x0D0D0D),
    // first two lifted to clear the card, as in src/theme.ts
    ghLevels: [
      Color(hex: 0x2A2A2A), Color(hex: 0x386021), Color(hex: 0x497B2D),
      Color(hex: 0x6DA939), Color(hex: 0x93C63F),
    ]
  )

  static let light = Theme(
    bg: Color(hex: 0xFFFFE3),
    ink: Color(hex: 0x4A4A4A),
    inkSoft: Color(hex: 0x5F6B78),
    line: Color(hex: 0xCBCBCB),
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

  /// Lock Screen: the system keeps only brightness, so every state is a shade of white.
  static let accessory = Theme(
    bg: .clear,
    ink: .white,
    inkSoft: .white.opacity(0.7),
    line: .white.opacity(0.3),
    accent: .white,
    cellEmpty: .white.opacity(0.2),
    done: .white,
    missed: .white.opacity(0.5),
    onState: .black,
    ghLevels: [
      .white.opacity(0.18), .white.opacity(0.4), .white.opacity(0.6), .white.opacity(0.8), .white,
    ]
  )

  /// Follows the app's appearance setting; the system scheme is only the fallback.
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
