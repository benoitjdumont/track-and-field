# Track & Field

3D satellite GPS route recorder, media waypoint logger, and flyover video creator.

## Features
- **3D Map & GPS Recording**: MapLibre GL 3D view with Satellite imagery, 3D Buildings, 3D Terrain elevation, adjustable 3D pitch angle (`0°–75°`), and live GPS tracking.
- **Live Media Waypoints (`+`)**: Pin photos, 15s video clips, and voice notes directly onto your route.
- **Creation Mode**:
  - Interactive 3D flyover playback & `9:16` / `16:9` video export.
  - 10 seamless looping instrumental tracks (no vocals).
  - Audio-first Fade In, video Fade Out into a Final Stats Summary outro, followed by music Fade Out.
  - Route stats, elevation profile chart, GPX 1.1 export, PNG snapshot export, and native/social sharing.
  - AI Story & Route Coach powered server-side via `@google/genai`.
- **Settings & Personalization**: Automatic Night Mode (`Auto / Night / Day`), 6 accent colors, `FR / EN` language toggle, haptic feedback toggle, and Capacitor Android APK configuration.

## Local Setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy environment variables and set your Gemini API key:
   ```bash
   cp .env.example .env
   ```
3. Run the development server (Express + Vite on port `3000`):
   ```bash
   npm run dev
   ```
4. Build for production:
   ```bash
   npm run build
   ```

## Android APK Packaging (Capacitor)

```bash
npm run build
npm i @capacitor/core @capacitor/cli @capacitor/android
npx cap add android
npx cap sync
npx cap open android
```
Then build the APK inside Android Studio (`Build > Build Bundle(s) / APK(s) > Build APK(s)`).
