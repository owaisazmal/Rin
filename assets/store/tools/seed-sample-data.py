"""Write the sample dataset the store screenshots were shot with into an iOS simulator's AsyncStorage.

Usage: python3 seed-sample-data.py <path to RCTAsyncLocalStorage_V1/manifest.json>

The path is <app data container>/Library/Application Support/com.owaiskhan.monthlyplanning/RCTAsyncLocalStorage_V1/manifest.json,
where the container comes from `xcrun simctl get_app_container <udid> com.owaiskhan.monthlyplanning data`.
Only ever point this at a throwaway simulator with no backup code: a phone with a code would push the seeded
months to its backup on the next launch.
"""
import calendar, datetime as dt, json, os, random, sys

random.seed(2026)
HABITS = [{"id": str(i), "name": n} for i, n in enumerate(["Wake 6:00", "Read 20 pages", "Train", "No sugar", "Journal"])]
TODAY = dt.date.today()
# done-rate per month, misses sprinkled in; every day from mid-July on stays active so the streak reads ~50
RATES = {3: 0.70, 4: 0.78, 5: 0.85, 6: 0.88, 7: 0.90, 8: 0.93, 9: 1.0}
STREAK_FROM = dt.date(TODAY.year, 7, 20)
BLANK_DAY = dt.date(TODAY.year, 7, 19)  # one blank day breaks the run, so the badge reads a believable number

store = {}
for m, rate in RATES.items():
    days = calendar.monthrange(TODAY.year, m)[1]
    grid = {}
    for day in range(1, days + 1):
        date = dt.date(TODAY.year, m, day)
        if date > TODAY or date == BLANK_DAY:
            continue
        states = []
        for h in HABITS:
            if date == TODAY:
                states.append(1 if h["id"] in ("0", "1", "2") else 0)  # today: three ticked, two still pending
                continue
            r = random.random()
            states.append(1 if r < rate else 2 if r < rate + 0.06 else 0)
        if STREAK_FROM <= date < TODAY and 1 not in states:
            states[0] = 1
        if date >= TODAY - dt.timedelta(days=17) and date < TODAY and random.random() < 0.7:
            states = [1] * 5
        for h, st in zip(HABITS, states):
            if st:
                grid[f"{day}:{h['id']}"] = st
    month = {"habits": HABITS, "grid": grid, "observations": ["", "", "", ""],
             "keyGoals": [{"text": "", "done": False} for _ in range(3)]}
    if m == TODAY.month:
        month["grid"]["3:3"] = 2
        month["grid"]["7:4"] = 2
        month["observations"] = ["Travel weeks are hard — plan lighter.", "Reading before bed sticks better than mornings.",
                                 "Sunday prep makes for calmer Mondays.", ""]
        month["keyGoals"] = [{"text": "Ship v1", "done": True}, {"text": "Run 50k", "done": False}, {"text": "Read 3 books", "done": False}]
    store[f"@monthly-planning/{TODAY.year}-{m:02d}"] = json.dumps(month, separators=(",", ":"), ensure_ascii=False)

def at(d, h, mi):
    return int(dt.datetime.combine(d, dt.time(h, mi)).timestamp() * 1000)
tasks = [
    {"id": "0", "text": "Dentist appointment", "due": at(TODAY + dt.timedelta(days=2), 9, 30), "done": False},
    {"id": "1", "text": "Renew passport", "due": at(TODAY + dt.timedelta(days=7), 18, 0), "done": False},
    {"id": "2", "text": "Quarterly report", "due": at(TODAY + dt.timedelta(days=21), 17, 0), "done": False},
    {"id": "3", "text": "Book flights", "due": at(TODAY - dt.timedelta(days=5), 12, 0), "done": True,
     "completedAt": at(TODAY - dt.timedelta(days=6), 20, 15)},
]
store["@monthly-planning/tasks"] = json.dumps(tasks, separators=(",", ":"))
store["@monthly-planning/settings"] = json.dumps({"theme": "dark", "chart": "radial"}, separators=(",", ":"))
store["@monthly-planning/backup"] = json.dumps({"onboarded": True, "lastBackupAt": None}, separators=(",", ":"))
store["@monthly-planning/backup-turned-away"] = json.dumps({"count": 0, "at": 0}, separators=(",", ":"))
store["@monthly-planning/intro-seen"] = "1"

out = sys.argv[1]
os.makedirs(os.path.dirname(out), exist_ok=True)
json.dump(store, open(out, "w"), ensure_ascii=False)
print("seeded", len(store), "keys into", out)
