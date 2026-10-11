# Store screenshots

Screenshots for both listings, built from the same seven compositions:

| Folder | Size | For |
| --- | --- | --- |
| `google-play/` | 1080 × 1920 px, 9:16, 24-bit PNG | Google Play → Phone screenshots (2–8, ≤ 8 MB each, 16:9 or 9:16, sides 320–3,840 px) |
| `app-store/` | 1320 × 2868 px, 24-bit PNG | App Store Connect → iPhone 6.9" display. Also accepted for 6.9" is 1290 × 2796. |
| `app-store-65/` | 1284 × 2778 px, 24-bit PNG | App Store Connect → iPhone 6.5" display. The 6.9" set, resized. |
| `app-store-ipad/` | 2064 × 2752 px, 24-bit PNG | App Store Connect → iPad 13" display. Slides 01–05 only. |
| `app-store-duo/outer/` | 1398 × 2034 px, 24-bit PNG | App Store Connect → iPhone Duo, outer display. Slides 01–05 only. |
| `app-store-duo/inner/` | 2007 × 2853 px, 24-bit PNG | App Store Connect → iPhone Duo, inner display. Slides 01–05 only. |

Both stores want no alpha channel; every file here is flat RGB. Upload in the numbered order.

| # | Caption | Theme | Screen |
| --- | --- | --- | --- |
| 01 | One ring per habit, one sector per day | dark | Planner, radial tracker |
| 02 | One tap per habit. That is the whole ritual. | dark | Daily check and deadlines |
| 03 | Every day of the year, in one grid | light | Planner, year grid |
| 04 | What actually happened, newest first | light | History |
| 05 | Ten habits, three goals, and room for the why | dark | Deadlines, key goals, observations, daily quote |
| 06 | Your month on the home screen | dark | Home-screen widgets |
| 07 | Both themes, widgets included | light | Home-screen widgets |

Slides 01–05 use the same iPhone captures on both stores. The widget slides differ:
the Play set shows the Android launcher (`screenshots/*/android/widgets/page*.png`),
the App Store set shows the iOS home screen. Status bars and home indicators are
cut from every capture, so the phone frame is platform-neutral.

The iPad set has its own captures, taken on an iPad Pro 13" (M5) simulator on
10 Oct 2026, shown as a close-up with no bezel that runs off both sides and the bottom.
An iPad screen holds most of the planner at once, so slide 02 is scrolled to the
daily check and slide 05 was shot with the Deadlines card hidden and cropped to
start under the habit list; the two no longer show the same cards. It has no
widget slides.

The Duo sets are not Duo captures. Xcode 27.0 has no iPhone Duo simulator (it
arrives with 27.1), so they are the iPhone 17 Pro Max gallery shots in the phone
frame at the two Duo sizes. Retake them on a Duo simulator before relying on them.

## Sample data

The app screens were shot on a throwaway iPhone 17 Pro Max simulator with the
dataset in `tools/seed-sample-data.py`: five habits, March to today, a streak
running from 20 July (82 days when these were taken, on 9 Oct 2026), three open
deadlines, three goals and three notes. The Android widget captures use the same
dataset, written into a throwaway emulator.

## Regenerating

1. Create a fresh simulator, install the app, and seed it — never a device that
   holds a backup code, or the seed would be pushed to that backup:
   ```bash
   UDID=$(xcrun simctl create "Rin Shots" com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro-Max com.apple.CoreSimulator.SimRuntime.iOS-27-0)
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
   every folder above except the 6.5" one. The iPad captures go in `CAPTURES/` too, as `ipad-01-radial-dark.png`
   and so on. It needs Google Chrome (rasterising), Pillow, and the Josefin
   Sans files from `node_modules`.
4. The 6.5" set is the 6.9" one resized:
   ```bash
   for f in assets/store/app-store/*.png; do sips -z 2778 1284 "$f" --out "assets/store/app-store-65/$(basename "$f")"; done
   ```
