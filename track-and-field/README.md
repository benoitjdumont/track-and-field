# Track & Field

GPS activity recorder with a live 3D map, media waypoints, route statistics, elevation analysis, AI storytelling, and social sharing.

## Features
- Live GPS recording that continues while stationary; stillness never pauses an activity.
- 3D satellite map, terrain relief, and 3D buildings.
- Photo, video, and voice-note waypoints attached to the recorded route.
- Interactive elevation profile with hover/tap altitude details.
- Average and best pace statistics.
- AI route story and coach analysis powered by Gemini.
- Native sharing for social apps and GPX export.
- Saved activities, music, and appearance settings.


## Native Android migration (Kotlin)

The native Android application is being developed in `app/` with Jetpack Compose.

Implemented in the current native foundation:
- Native Compose interface using the pale-blue GyroRider visual style.
- Android foreground location service for GPS recording.
- Local storage of route points.
- Live distance, elapsed time, average pace, and estimated elevation-gain calculations.
- GitHub Actions workflow that builds and publishes a downloadable debug APK artifact.

Still to be migrated and validated on a physical device:
- Native interactive map, satellite imagery, terrain and 3D buildings.
- Route/media waypoints, photo and video capture, and recap storage.
- Elevation chart, video creation, music, sharing, and Gemini-assisted features.
- Background-location permission flow and long-duration tracking validation on Samsung devices.

The Kotlin app is a work in progress; the feature list above describes the broader project, not a claim that every feature is already present in the native APK.
