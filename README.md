# Mental Math

A calm, ten-minute daily drill for the maths that comes up at work and at home: quick multiplication, percentages and % change, GBP/USD/EUR conversions and Toman conversions. It's an installable web app for iPhone that works offline and keeps your data on your phone.

## Install on iPhone
1. Open the GitHub Pages link in **Safari**.
2. Tap **Share → Add to Home Screen**.
3. Open it from the home screen. It runs full screen and works offline.

## What's in this version (blueprint phases 1 + 2)
- One question at a time, custom keypad, and "Correct." / "Not quite. Try again." feedback only. **Explain** shows the method only when you tap it.
- Close answers count (±2% by default, set per skill). A stray zero is always wrong.
- Friendly, round numbers, generated fresh each time across 5 skills and 24 levels.
- Mastery score for each skill, a review queue that brings misses back after 1, 3 and 7 days, and a weak-spot-focused daily mix.
- Step-up offers only when you've earned them, and the level only goes up if you tap **Step up**.
- Progress: streak, a 5-week calendar, a first-try accuracy trend with level and rate changes marked, skill bars, error patterns (like multiplying instead of dividing on $ → £) and a change log.
- Settings: difficulty per skill (level, practise / review only / pause, step-up rule, auto step-down), exchange rates with history, sessions, marking, display, and data export (CSV).

## Develop
```bash
npm install
npm run dev      # local dev server
npm test         # engine tests
npm run build    # production build in dist/
```
Pushing to `main` deploys to GitHub Pages through `.github/workflows/deploy.yml`. In the repo, go to **Settings → Pages → Source** and choose **GitHub Actions** once.

## Code map
- `src/engine/skills.ts`: skills and levels
- `src/engine/generate.ts`: question generators (friendly numbers, hints)
- `src/engine/logic.ts`: marking, mastery, review queue, planner, step-ups, streak
- `src/store.ts`: defaults, local storage, CSV export
- `src/main.ts`: screens and interactions
- `src/style.css`: soft-UI design
