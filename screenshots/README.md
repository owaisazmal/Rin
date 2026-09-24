# Screenshots

Sorted by theme, then platform, then form factor. `dark/` and `light/` have the same shape:

```
dark/ · light/
├── ios/
│   ├── phone/     iPhone SE (3rd gen), 13 mini, 17, 17 Pro Max, and the SE at the largest text size
│   ├── tablet/    iPad mini (A17 Pro), iPad (A16), iPad Pro 11" and 13" (M5), and the 13" in landscape
│   └── widgets/   home screen widgets
└── android/
    ├── phone/     720×1280, 1080×2400 and 1344×2992 phones, and the small one at 1.3× font
    ├── tablet/    a foldable's inner screen, a 7" tablet, and a 10" tablet held both ways
    └── widgets/   home screen widgets
```

A device's dark folder holds shots 01–09 and its light folder holds 10–13, so two sizes compare file by file:

- dark: `01-intro` · `02-welcome` · `03-planner-empty` · `04-planner` · `05-daily-check` · `06-deadlines-goals` · `07-notes` · `08-year-grid` · `09-settings`
- light: `10-settings-light` · `11-history-light` · `12-year-grid-light` · `13-planner-light`

[`widgets.md`](widgets.md) says what each widget shot shows, and [`readme/`](readme/) holds the four images the main README uses.

Taken on 23 Sep 2026 from debug builds on iOS 26.1 simulators and an Android 16 emulator, with the sample data in [`assets/store/tools/seed-sample-data.py`](../assets/store/tools/seed-sample-data.py). Device shots are JPEG to keep the repo light. Store listing images live in [`assets/store/`](../assets/store/).
