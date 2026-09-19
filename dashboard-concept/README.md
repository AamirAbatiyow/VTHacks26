# Vocally dashboard concept

An independent, static dashboard based on the annotated sketch. The existing `conversational-ai/client` UI is unchanged.

## Run

From this directory:

```sh
python3 -m http.server 5180
```

Open http://localhost:5180. No install or build step is needed.

## Sketch translated into interactions

- Existing Vocally wordmark, a large serif greeting, and a top-right practice shortcut.
- Four bottom cards: daily challenges, achievements, practice minutes, and streaks.
- Staggered upward entrances; each card opens an upward-moving full-screen dialog.
- Native modal focus management, Escape to close, responsive layouts, and reduced-motion support.
- Daily challenge checkboxes, manual practice entries, seven-day charts, derived milestones and streaks.
- Edit the name and practice URL through **Demo profile** or the greeting.

The starter profile is explicitly demo data, including historical sessions. Changes persist under `vocally-dashboard-concept-v1` in localStorage. Challenge completion resets by local calendar date; historical activity stays available for streaks. Clear that key to reset the demo. Live user data and the voice backend are not connected. The practice shortcut defaults to the existing app at `http://localhost:5173`; start that app separately or edit the URL.

`app.js` centralizes the data shape (`name`, `practiceUrl`, `challenges`, `sessions`) for future API integration. No profile values are sent to a server. Google Fonts is optional; local serif and sans-serif fallbacks work offline. The copied wordmark asset comes from the existing project.
