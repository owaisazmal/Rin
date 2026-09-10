# Store screenshots

Phone screenshots for both listings, built from the same seven compositions:

| Folder | Size | For |
| --- | --- | --- |
| `google-play/` | 1080 × 1920 px, 9:16, 24-bit PNG | Google Play → Phone screenshots (2–8, ≤ 8 MB each, 16:9 or 9:16, sides 320–3,840 px) |
| `app-store/` | 1320 × 2868 px, 24-bit PNG | App Store Connect → iPhone 6.9" display. Also accepted for 6.9" is 1290 × 2796. |

Both stores want no alpha channel; every file here is flat RGB. Upload in the numbered order.

| # | Caption | Theme | Screen |
| --- | --- | --- | --- |
| 01 | One ring per habit, one sector per day | dark | Planner, radial tracker |
| 02 | One tap per habit. That is the whole ritual. | dark | Daily check and deadlines |
| 03 | Every day of the year, in one grid | light | Planner, year grid |
| 04 | What actually happened, newest first | light | History |
| 05 | Ten habits, three goals, and room for the why | dark | Habits, key goals, observations |
| 06 | Your month on the home screen | dark | Home-screen widgets |
| 07 | Both themes, widgets included | light | Home-screen widgets |

Slides 01–05 use the same iPhone captures on both stores. The widget slides differ:
the Play set shows the Android launcher (`screenshot-widgets/android-page*.png`),
the App Store set shows the iOS home screen. Status bars and home indicators are
cut from every capture, so the phone frame is platform-neutral.

## Sample data

The app screens were shot on a throwaway iPhone 17 Pro Max simulator with the
dataset in `tools/seed-sample-data.py`: five habits, March to today, a 53-day
streak, three open deadlines, three goals and three notes. The Android widget
captures are older (August, 64-day streak), so those two numbers differ from the
rest of the set.

## Regenerating

1. Create a fresh simulator, install the app, and seed it — never a device that
   holds a backup code, or the seed would be pushed to that backup:
   ```bash
   UDID=$(xcrun simctl create "Rin Shots" com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro-Max com.apple.CoreSimulator.SimRuntime.iOS-26-1)
   xcrun simctl boot "$UDID" && xcrun simctl install "$UDID" path/to/Rin.app
   C=$(xcrun simctl get_app_container "$UDID" com.owaiskhan.monthlyplanning data)
   python3 assets/store/tools/seed-sample-data.py "$C/Library/Application Support/com.owaiskhan.monthlyplanning/RCTAsyncLocalStorage_V1/manifest.json"
   xcrun simctl status_bar "$UDID" override --time 9:41 --batteryState discharging --batteryLevel 100 --wifiBars 3 --cellularBars 4
   xcrun simctl launch "$UDID" com.owaiskhan.monthlyplanning
   ```
2. Capture each screen with `xcrun simctl io "$UDID" screenshot --type=png <file>`
   into a `CAPTURES/` folder next to `tools/slides.json`, using the file names
   that file expects.
3. `python3 assets/store/tools/compose.py assets/store/tools/slides.json` rewrites
   both folders. It needs Google Chrome (rasterising), Pillow, and the Josefin
   Sans files from `node_modules`.
