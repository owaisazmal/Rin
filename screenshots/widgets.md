# Widget screenshots

Captured from the iPhone 16 Pro simulator with sample data (four habits, May–Aug
2026). Every page is shot in both themes — the widgets follow the app's own
theme toggle, which they read from the snapshot. The system appearance is only
the fallback, for a widget placed before the app has ever written one.

The iOS shots are in [`dark/ios/widgets/`](dark/ios/widgets/) and [`light/ios/widgets/`](light/ios/widgets/).

| File | Widgets shown |
| --- | --- |
| `smalls-*.png` | Radial Tracker · Month Progress · Streak · Today's Check (all small), plus Radial Tracker medium |
| `mediums-*.png` | Year Tracker · Streak · Month Progress (all medium) |
| `medium2-*.png` | Today's Check · Key Goals · Radial Tracker (all medium) |
| `large-radial-*.png` | Radial Tracker large, with Key Goals medium |
| `large-today-*.png` | Today's Check large, with Year Tracker medium |
| `large-goals-*.png` | Key Goals large, with Month Progress medium |
| `quotes-*.png` | Daily Quote small and medium |
| `quote-large-*.png` | Daily Quote large — quote, today's tally, and year progress |

## Sizes offered

| Widget | small | medium | large | Lock Screen |
| --- | :-: | :-: | :-: | :-: |
| Radial Tracker | ● | ● | ● | |
| Year Tracker | | ● | | |
| Month Progress | ● | ● | | |
| Streak | ● | ● | | ● circular · rectangular · inline |
| Today's Check | ● | ● | ● | |
| Key Goals | | ● | ● | |
| Daily Quote | ● | ● | ● | ● rectangular |

Year Tracker is medium-only: a full year needs ~53 columns, which at a large
widget's width forces cells down to ~5pt — a stripe of confetti with most of the
card empty. The 17-week window reads better.

Daily Quote shows one quote per day, chosen by day-of-year from the same list
the app uses, so the widget and the app always agree. It rolls over at midnight
on its own — the widget picks from the list rather than being handed today's
quote, so it doesn't depend on the app being opened.

The Lock Screen accessories are not pictured. They render on the lock screen,
which is not part of the home-screen layout these shots come from.

## Android

In [`dark/android/widgets/`](dark/android/widgets/) and [`light/android/widgets/`](light/android/widgets/):
`page1-*.png` — Radial Tracker · Month Progress · Streak · Today's Check
`page2-*.png` — Year Tracker · Daily Quote · Key Goals

All seven widgets exist on both platforms, built with Jetpack Glance from the
same JSON snapshot. Two differences are inherent to the platform:

- **No fixed sizes.** Android widgets are freely resizable, so each declares
  `minWidth`/`minHeight` and uses `SizeMode.Exact`, deriving its chart, grid and
  row dimensions from the size it was actually handed. (`SizeMode.Responsive`
  reports the nearest declared breakpoint instead of the real size, which pinned
  charts to a fixed size and left most of each card empty.)
- **No Lock Screen widgets.** The iOS accessory variants have no counterpart.

Glance has no canvas primitive, so the radial rings, the year grid, the progress
ring and the pip strip are rasterised with `android.graphics.Canvas` and handed
over as `Image`s (see `targets/android-widgets/kotlin/Charts.kt`). The geometry
is a direct port of the SwiftUI `Shape` code.

One nuance worth knowing: the chart bitmaps bake their colours at draw time, so
a widget only restyles when the app pushes a new snapshot. Toggling the theme in
Settings pushes one, which is the case that matters. A cold start pushes one too,
since the snapshot effect fires on mount. Re-opening an app that's already
running does not — nothing changed, so nothing is sent — and neither does a bare
`APPWIDGET_UPDATE` broadcast, which arrives without the ids Glance needs.
