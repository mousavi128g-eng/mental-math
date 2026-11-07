# Mental Math

A calm, ten-minute daily drill for the maths that comes up at work and at home: quick multiplication, percentages and % change, GBP/USD/EUR conversions and Toman conversions. It's an installable web app for iPhone that works offline and keeps your data on your phone.

## Install on iPhone
1. Open the GitHub Pages link in **Safari**.
2. Tap **Share → Add to Home Screen**.
3. Open it from the home screen. It runs full screen and works offline.

## What's in this version (v0.3: blueprint phases 1 to 3)
- **Clear questions:** every question has a one-line instruction, shows the rate it uses (e.g. £1 = $1.27) and puts the unit next to the answer.
- **Wrong answers:** you see the correct answer and a short explanation, then tap Next. Retries are optional in Settings.
- **Estimates:** tap **≈ Estimate** on any question. Within ±10% counts as a good estimate. Questions marked "Estimate welcome" accept estimates automatically, and there's an Estimation round too.
- **In-session menu (⋯):** skip, hint, answer as an estimate, restart with new questions, show a timer, end the session.
- **Practice tab and menu:** today's session, quick 5, weak spot, estimation round, review misses, or drill any one skill.
- **Progress:** Overview (stats, calendar, trend with level and rate changes marked, error patterns), Skills (mastery, speed, sparklines, a detail page for each skill), History (tap a session to see every answer) and Awards (personal bests and milestones).
- **Habit:** streak with one freeze per week, a weekly review, a daily reminder added to your calendar, and a quiet mode.
- **Rates:** set your own, or switch to live daily £/$/€ rates (ECB data). Toman is always set by you, with a reminder to update it. There's a full rate history.
- **Adaptive:** a mastery score for each skill, misses that come back after 1, 3 and 7 days, and step-up offers that only change your level if you accept.

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
