# Widget screenshots

Captured from the iPhone 17 simulator with the sample data in
[`assets/store/tools/seed-sample-data.py`](../assets/store/tools/seed-sample-data.py)
(five habits, March to October 2026). Every page is shot in both themes — the
widgets follow the app's own theme toggle, which they read from the snapshot.
The system appearance is only the fallback, for a widget placed before the app
has ever written one.

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
| Radial Tracker | ● | ● | ● | ● circular |
| Year Tracker | | ● | | ● rectangular |
| Month Progress | ● | ● | | ● circular · rectangular · inline |
| Streak | ● | ● | | ● circular · rectangular · inline |
| Today's Check | ● | ● | ● | ● circular · rectangular · inline |
| Key Goals | | ● | ● | ● rectangular · inline |
| Daily Quote | ● | ● | ● | ● rectangular |
| Deadlines | ● | ● | ● | ● rectangular · inline |

On the Home Screen, Year Tracker is medium-only: a full year needs ~53 columns, which at a large
widget's width forces cells down to ~5pt — a stripe of confetti with most of the
card empty. The 17-week window reads better.

Daily Quote shows one quote per day, chosen by day-of-year from the same list
the app uses, so the widget and the app always agree. It rolls over at midnight
on its own — the widget picks from the list rather than being handed today's
quote, so it doesn't depend on the app being opened.

## Lock Screen

| Widget | Slot | Shows |
| --- | --- | --- |
| Radial Tracker | circular | the month's rings, done bright, missed dimmer, pending faint |
| Year Tracker | rectangular | the last 16 weeks of the year grid |
| Month Progress | circular | a ring with the month's percentage |
| Month Progress | rectangular | the percentage, a bar, and how many check-ins of the month's total |
| Month Progress | inline | `42% of October done` |
| Streak | circular | the current streak in days, under a flame |
| Streak | rectangular | the current streak, the best this year, and how much of the month is done |
| Streak | inline | `9d streak · 42%` |
| Today's Check | circular | a ring with today's tally, `3/5` |
| Today's Check | rectangular | today's tally and the habits still open; past three, the last line counts the rest |
| Today's Check | inline | `3 of 5 done today` |
| Key Goals | rectangular | the month's goals with a filled or open circle each |
| Key Goals | inline | `1 of 3 goals done` |
| Daily Quote | rectangular | today's quote; a long one gives up the heading, and one that still won't fit keeps its first sentence |
| Deadlines | rectangular | the next deadline and the time left on it |
| Deadlines | inline | `5h left · Send the tax return`, countdown first, so a long title loses its end rather than the countdown |

The Lock Screen draws every accessory in one colour, so the states are shapes
or shades: the flame is filled once today is marked and an outline while the
streak is waiting on today, open habits and goals are open circles, an overdue
deadline swaps the hourglass for an exclamation mark, and the charts use
brightness for done, missed and pending. Accessories don't follow the app's
theme either, which is why they are only in the dark folder.

On the iPhone SE, the tightest Lock Screen on iOS 27, a slot is 68pt (circular)
or 153 × 68pt (rectangular), and the system keeps a 6pt margin inside it, so the
content gets 56pt or 141 × 56pt. Text may run into that margin without being
cut, which the three-line layouts and the quote rely on.

### Captures

[`lock-screen-se-1.png`](dark/ios/widgets/lock-screen-se-1.png),
[`lock-screen-se-2.png`](dark/ios/widgets/lock-screen-se-2.png) and
[`lock-screen-se-3.png`](dark/ios/widgets/lock-screen-se-3.png) are the real Lock
Screen of an iPhone SE simulator on iOS 27.0, with the widgets placed through
the Lock Screen editor. The first is in the default style with the gallery's
sample data. The second and third are tinted, with long names, an overdue task
and the longest single-sentence quote. Every family was also checked in the
editor's widget gallery, which WidgetKit draws with the same data.

### Renders

[`lock-screen-vibrant.png`](dark/ios/widgets/lock-screen-vibrant.png),
[`lock-screen-tinted.png`](dark/ios/widgets/lock-screen-tinted.png) and
[`lock-screen-always-on.png`](dark/ios/widgets/lock-screen-always-on.png) show
every accessory at those content sizes with four sets of data: typical, long
text and big numbers, a streak still waiting on today, and nothing at all.
They are drawn headlessly and given the system's treatment by hand:
brightness becomes the opacity of white (vibrant) or of a tint colour
(tinted), and always-on dims the wallpaper and the widget. Their layout,
wrapping and truncation match the captures. The always-on page is the only
look at that mode: the simulator has no always-on display, so it still needs a
check on an iPhone that has one.

## Android

In [`dark/android/widgets/`](dark/android/widgets/) and [`light/android/widgets/`](light/android/widgets/),
from a Pixel launcher on its 4 × 5 grid, with the same sample data as the iOS pages:
`page1-*.png` — Radial Tracker · Month Progress · Streak · Today's Check
`page2-*.png` — Year Tracker · Key Goals
`page3-*.png` — Daily Quote at 2 × 2 and at 4 × 2

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
