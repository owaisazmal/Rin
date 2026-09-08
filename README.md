<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo/logo-dark.svg">
    <img alt="Rin — Monthly Planning" src="assets/logo/logo-light.svg" width="440">
  </picture>
</p>

# Rin
*凛 (rin) — quiet composure, discipline that doesn't waver.*

Free and open-source. A digital version of the whiteboard "Monthly Planning" board — Rin's home screen — with a **radial habit tracker**, built with Expo / React Native for iOS and Android.

| Planner | Year grid | Daily check | Widgets |
| :-: | :-: | :-: | :-: |
| ![Radial tracker on iOS in dark mode](screenshots/planner-ios-dark.png) | ![Year grid on Android in light mode](screenshots/year-android-light.png) | ![Daily check and habit list on iOS](screenshots/daily-ios-dark.png) | ![Home screen widgets on Android](screenshots/widgets-android-light.png) |
| iOS · dark | Android · light | iOS · dark | Android · light |

Sample data, not a real month. The full set of widget layouts for both
platforms is in [`screenshot-widgets/`](screenshot-widgets/).

## Open, and staying that way

I built this for myself, and then put it somewhere anyone could take it.

**Nothing you write here leaves your phone unless you ask it to.** No
analytics, no trackers, no crash reporters, no ad SDKs. Your habits, notes and
goals live in local storage on the device. The one exception is a backup, which
you turn on yourself: it is encrypted on the phone with a code only you hold,
so what reaches the server is ciphertext filed under a number. There are no
accounts — no name, no email, no password — and the app is fully usable
without ever making a backup.

**The source stays public for as long as this app exists.** That is a promise
about the licence, not just the current state of the repo. See [LICENSE](LICENSE).

**If something here annoys you, change it.** Fork it, strip out the parts you
don't want, build the version you would rather use. That is the entire point of
it being open. You don't need permission and you don't need to ask.

Credit is entirely optional and I would never dream of asking. It's just that
"Owais Khan" fits very comfortably in a footer, costs you one line, and I will
be refreshing the forks page regardless, serene, unbothered, definitely not
counting.

### Backups, when they get a backend

Nothing is sent anywhere yet. When it is, there will still be no accounts: no
name, no email, no password. A backup is encrypted on the phone with a code
only the phone holds, and the server stores ciphertext under an id derived from
that code, so neither Google nor I can read it. [`firestore.rules`](firestore.rules)
is the entire server side: signed-in installs only, no listing, fixed shapes
and sizes. The code lives in the Keychain / Keystore through `src/session.ts`;
Firebase's config files stay out of the repo ([`.env.example`](.env.example));
and the phone re-validates everything it reads back.

## Features

- **Radial habit tracker**: the circle is divided into one sector per day of the month and one ring per habit (innermost ring = habit 1). Tap a cell to cycle: pending → **done** (green) → **missed** (red) → pending. Today's date is highlighted.
- **Yearly grid**: switch the tracker to a GitHub-style contribution graph of the whole year. Cell intensity reflects how many habits you completed that day; tap any cell to jump to that month and day. Auto-scrolls to the open month.
- **Daily check**: a per-day checklist with ✓ / ✗ buttons, so filling the chart is one tap per habit. Navigate days with the arrows; today is badged.
- **Habits**: add, rename, and remove up to 10 habits per month. Removing a habit with marks asks for confirmation.
- **Deadlines**: tasks with a date and time on them, below the daily check. Each row shows how long is left, and a bar that fills over the final week, so the pressure is visible between the colour bands as well as through them. Reminders escalate as the date approaches: three days out, one day, three hours, one hour, and at the deadline itself, with one nag the morning after a missed one. They live on their own Android notification channel, so the daily habit nudges can be muted without losing them. Ticking one off files it away: the section lists only what is still outstanding, with a count of the finished ones and a link straight through to history. The widgets and the reminders ignore finished tasks too, because a deadline you have met is not a deadline any more.
- **History**: a read-only log of what actually happened, newest first. It shows which habits were ticked or missed each day, and which deadlines were finished on time or late. Filter by habits or deadlines, and page further back six months at a time. Derived from the months and tasks already stored, so there is no second copy to fall out of step.
- **Observations**: free-form note lines, add/remove as needed.
- **Key Goals**: three goal boxes with a "mark done" toggle.
- **Discipline quote**: rotates daily.
- **Dark mode**: on by default, switched in Settings. The choice persists, and the home-screen widgets follow it.
- **Widgets**: eight of them on both platforms (radial, year, streak, today, goals, progress, daily quote, deadlines), plus Lock Screen accessories on iOS.
- **Reminders**: a few nudges a day, only while something is still unmarked, and a note when the day is done. Habit nudges and deadline reminders are rewritten together, within a budget, because iOS keeps only the 64 soonest pending local notifications.
- **Backup**: optional, and only for carrying your months to a new phone. One code, generated on the device, encrypts everything before it leaves and is the only thing that can read it back. No account, and no way to recover a lost code — which is the same sentence twice, and why the app says so before you rely on it.
- **Month navigation**: every month keeps its own habits, grid, observations, and goals, persisted on-device with AsyncStorage.

## Run it

```bash
npm install
npx expo start
```

The widgets and the backup server are native, so this needs a development
build rather than Expo Go:

- **iOS simulator** (needs Xcode): `npx expo run:ios`
- **Android emulator** (needs Android Studio): `npx expo run:android`

## Test it

```bash
npm test
```

Covers the pure logic: how streaks are counted, how close a deadline is, what
history says happened, what the stores will accept off disk, and whether a
session survives the keychain. None of it renders, so the suite runs in plain
Node in well under a second. `npm run test:rules` is the server side: it starts
the Firestore emulator and checks every way the rules should say no.

That is a deliberate line. These modules hold the parts that are easy to
get quietly wrong: a run of days crossing a month border, a deadline landing
exactly on an urgency boundary, a day that is 23 hours long because the clocks
went forward, a stored record from an older version of the app. The screens are
checked by looking at them; this is for the arithmetic underneath, which looks
the same whether or not it is right.

## Ship it

To produce store-ready binaries, use [EAS Build](https://docs.expo.dev/build/setup/):

```bash
npx eas build --platform all --profile production
```

`eas.json` carries three profiles: `development` (debug, iOS simulator and an
Android APK), `preview` (internal distribution for putting a real build on a
real device), and `production` (App Store / Play Store, an Android app bundle,
with the build number incremented for you). Version numbers live in `app.json`
rather than on Expo's servers, so what ships is whatever the repo says.

Firebase's two config files never enter the repo; `.env.example` says where
they go, locally and for EAS builds.

## Structure

```
App.tsx                        root: persisted settings, account, font, theme provider

src/theme.ts                   palettes, type scale, radii (the only place colour is defined)
src/types.ts                   data model (MonthData, Habit, cell states)
src/storage.ts                 AsyncStorage load/save per month + year summary
src/settings.ts                theme and chart choice
src/dates.ts                   calendar arithmetic and the month/day names
src/tasks.ts                   deadlines, kept outside MonthData since a date isn't a month
src/deadlines.ts               how close a deadline is, and how that should read
src/history.ts                 the day-by-day log, derived from months and tasks
src/streaks.ts                 how consecutive days are counted
src/backupState.ts             whether this phone has a backup, and where the code is kept
src/backup.ts                  the backup code, and the id and key derived from it
src/sync.ts                    the only code here that touches a network
src/session.ts                 where the code is kept: Keychain / Keystore, never AsyncStorage
src/onboarding.ts              whether the intro has been shown
src/quotes.ts                  discipline quotes, one per day
src/notifications.ts           reminder schedule

src/navigation/ScreenLayer     how a layer slides, recedes and swipes back
src/navigation/Navigator       which screens exist and what sits under what

src/screens/IntroScreen        four-page first run
src/screens/BackupScreen       make a backup, or restore one
src/screens/SettingsScreen     account + appearance
src/screens/HistoryScreen      the log, read-only
src/screens/PlannerScreen      the planner, layout and gestures only

src/hooks/useMonthData         the open month and every way it changes
src/hooks/useYearSummary       year load + live tally overlay
src/hooks/useCurrentStreak     the header flame
src/hooks/useTasks             the deadline list and every way it changes
src/hooks/useHistory           the history window, and paging further back
src/hooks/useNow               a coarse clock, for the things that age on their own
src/hooks/useOutboundSync      pushes to widgets and reminders
src/hooks/useChartTransition   how the tracker and the month label arrive

src/__tests__/                 the pure logic: streaks, deadlines, history, storage, settings, tasks, session

src/components/                TrackerCard, MonthNav, RadialTracker, YearChart, DailyCheck,
                               HabitsList, Observations, KeyGoals, Deadlines, DueDatePicker,
                               StreakBadge, MarkButton, SegmentedControl,
                               AuroraBackground, …

src/widgets/                   snapshot written to the shared container
targets/widgets/               iOS WidgetKit (SwiftUI)
targets/android-widgets/       Android home screen (Jetpack Glance)
plugins/                       Expo config plugin for the Android widgets
firestore.rules                the entire server side: what a signed-in phone may store (not wired up yet)
firebase/                      the rules suite, run against the emulator
.env.example                   backend config; the real .env is never committed
```
