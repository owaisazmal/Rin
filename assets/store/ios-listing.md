# App Store listing copy (iOS)

App: Rin Monthly Planner · Apple ID 6814057957 · bundle com.owaiskhan.monthlyplanning

## Promotional Text (170)

A month of habits drawn as a circle. One ring per habit, one sector per day. Free, open source, and nothing leaves your phone unless you turn on a backup.

## Description (4,000)

Rin is a monthly planner built around one idea: a month should fit on a single screen.

THE RADIAL TRACKER
Every habit gets a ring, every day gets a sector. Mark a day done and it fills green, mark it missed and it turns red, leave it and it stays open. A whole month reads at a glance. Prefer a grid? Flip the same data to a year chart and see all twelve months at once.

THE DAILY CHECK
One card for today. Tick off what you did, mark what you skipped, move on. Earlier days stay one tap away for when you forget.

DEADLINES THAT GET LOUDER
Give a task a due date and it climbs as the date approaches: later, near, soon, now, overdue. The pressure is visible, so nothing quietly slips.

GOALS, NOTES AND HISTORY
Key goals for the month, an observations box for anything worth keeping, and a history view that holds every month you have finished.

HOME SCREEN WIDGETS
Rings, deadlines, habit progress and a quote, all available as widgets, so you see the month without opening the app.

REMINDERS
Optional reminders through the day, plus warnings as deadlines close in. They are scheduled on the phone itself. Nothing routes through a server.

STREAKS
A running count of consecutive days, kept honest by the daily check.

DARK AND LIGHT
Both, with a slow drifting aurora behind everything.

PRIVACY, SERIOUSLY
There are no accounts. No name, no email, no password. Your habits, notes and goals live in local storage on your device. No analytics, no trackers, no crash reporters, no ad SDKs.

Backup is optional and off by default. Turn it on and your month is encrypted on the phone with a code only you hold, so what reaches the server is ciphertext filed under a number. Nobody at the other end can read it, including me. The app is fully usable without ever making a backup.

FREE AND OPEN SOURCE
MIT licensed, and the source stays public for as long as this app exists. Read it, fork it, build the version you would rather use.

github.com/owaisazmal/Rin

## Keywords (100)

habit tracker,routine,streak,goals,deadlines,widget,open source,privacy,offline,checklist,ring

## URLs

Support URL:    https://github.com/owaisazmal/Rin/issues
Marketing URL:  https://owaisazmal.github.io/Rin/
Privacy Policy: https://owaisazmal.github.io/Rin/privacy.html

## Version / Copyright

Version:   1.0
Copyright: 2026 Owais Khan

## Routing App Coverage File

Leave empty. Not a maps app.

## App Review Information

Sign-In Information: leave "Sign-in required" UNCHECKED. There is no sign in.

Notes:

No account is needed. Everything works on first launch, with data kept in local
storage on the device.

Backup is optional and off by default. To test it: Settings, then Backup, then
create a backup. The app generates a recovery code on the device and signs in
anonymously to Firebase in the background. No personal data is requested at any
point, and the payload is encrypted on the phone before it is sent.

Home screen widgets read a snapshot the app writes to a shared app group
container. Add a habit and mark a day in the app first, then add a widget, so
there is data for it to show.

## App Store Version Release

Manually release this version.

## Elsewhere in the sidebar

App Information: Category Productivity (secondary Health and Fitness), Age Rating 4+
App Privacy:     required before review, must match docs/privacy.html
Pricing:         Free

## TestFlight Test Information (external group)

Feedback email:  (your email)
Privacy Policy:  https://owaisazmal.github.io/Rin/privacy.html
Marketing URL:   https://owaisazmal.github.io/Rin/

### Beta App Description

Rin is a monthly planner built around a radial habit tracker: one ring per
habit, one sector per day, a whole month on a single screen. Everything lives
on your phone. There are no accounts and no analytics, and a backup is
optional and encrypted with a code only you hold.

### What to Test

Everything here works offline on the device. There is no account and no sign in,
so you can start the moment it opens.

START HERE
1. Add a few habits, then mark today done or missed in the Daily Check. The rings
   above should fill as you go.
2. Switch the tracker between Radial and Year. Both should read clearly at a glance.
3. Set your key goals for the month and write something in Observations.
4. Add a task with a due date a few days out, then one that is already past. Watch
   how the urgency changes as the date gets closer.
5. Press and hold your home screen, add a Rin widget, and check it shows the same
   thing the app does.
6. Flip the theme in Settings and give both dark and light a minute.

NEW IN THIS BUILD
Typing near the bottom of the screen. The keyboard should never cover the field
you are in, on the planner or in Backup, and Done should dismiss it cleanly. Try
it on goals, observations, habits and deadlines.

OPTIONAL, ONLY IF YOU WANT TO TEST BACKUP
Settings, then Backup, then create one. Your phone generates a recovery code.
Keep it somewhere safe, because it is the only way to restore and nobody else has
a copy, including me. Then try restoring on the same device. You are never asked
for an email, a password or a name.

WHAT I WANT TO HEAR ABOUT
Anything that looks wrong at a glance, anything that feels slow, any number that
does not match what you expected, and anywhere the text is too small or a tap
target too fiddly. Screenshots help a lot. In TestFlight you can take a
screenshot and send it straight back with a note.
