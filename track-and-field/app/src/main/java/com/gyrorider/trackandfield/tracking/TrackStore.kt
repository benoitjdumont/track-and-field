package com.gyrorider.trackandfield.tracking

import android.content.Context
import android.location.Location
import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.roundToInt

data class TrackStats(
    val distanceMeters: Double = 0.0,
    val durationMillis: Long = 0L,
    val averagePaceSecondsPerKm: Double? = null,
    val elevationGainMeters: Double = 0.0,
    val pointCount: Int = 0
)

object TrackStore {
    private const val PREFS = "track_and_field"
    private const val ACTIVE_POINTS = "active_points"

    fun append(context: Context, location: Location) {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val points = runCatching { JSONArray(prefs.getString(ACTIVE_POINTS, "[]")) }.getOrElse { JSONArray() }
        val previous = points.optJSONObject(points.length() - 1)
        if (previous != null) {
            val old = Location("stored").apply {
                latitude = previous.optDouble("lat")
                longitude = previous.optDouble("lon")
            }
            // Filter small GPS drift without stopping location collection.
            if (old.distanceTo(location) < 4f) return
        }
        points.put(JSONObject().apply {
            put("lat", location.latitude)
            put("lon", location.longitude)
            put("alt", if (location.hasAltitude()) location.altitude else JSONObject.NULL)
            put("time", location.time)
            put("accuracy", location.accuracy.toDouble())
        })
        prefs.edit().putString(ACTIVE_POINTS, points.toString()).apply()
    }

    fun currentPoints(context: Context): JSONArray {
        val raw = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(ACTIVE_POINTS, "[]")
        return runCatching { JSONArray(raw) }.getOrElse { JSONArray() }
    }

    fun routeCoordinates(context: Context): List<Pair<Double, Double>> {
        val points = currentPoints(context)
        return (0 until points.length()).mapNotNull { index ->
            val point = points.optJSONObject(index) ?: return@mapNotNull null
            val lat = point.optDouble("lat", Double.NaN)
            val lon = point.optDouble("lon", Double.NaN)
            if (lat.isFinite() && lon.isFinite()) lat to lon else null
        }
    }

    fun stats(context: Context): TrackStats {
        val points = currentPoints(context)
        if (points.length() == 0) return TrackStats()

        var distance = 0.0
        var elevationGain = 0.0
        var previousAltitude: Double? = null
        var firstTime: Long? = null
        var lastTime = 0L
        var previousLocation: Location? = null

        for (index in 0 until points.length()) {
            val point = points.optJSONObject(index) ?: continue
            val timestamp = point.optLong("time")
            if (firstTime == null) firstTime = timestamp
            lastTime = timestamp

            val location = Location("track").apply {
                latitude = point.optDouble("lat")
                longitude = point.optDouble("lon")
            }
            previousLocation?.let { distance += it.distanceTo(location).toDouble() }
            previousLocation = location

            if (!point.isNull("alt")) {
                val altitude = point.optDouble("alt")
                previousAltitude?.let { previous ->
                    val climb = altitude - previous
                    if (climb > 3.0) elevationGain += climb
                }
                previousAltitude = altitude
            }
        }

        val duration = if (firstTime != null) (lastTime - firstTime!!).coerceAtLeast(0L) else 0L
        val pace = if (distance >= 100.0 && duration > 0L) {
            duration / 1000.0 / (distance / 1000.0)
        } else null

        return TrackStats(distance, duration, pace, elevationGain, points.length())
    }

    fun clear(context: Context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().remove(ACTIVE_POINTS).apply()
    }

    fun formatDuration(milliseconds: Long): String {
        val seconds = milliseconds / 1000
        val hours = seconds / 3600
        val minutes = (seconds % 3600) / 60
        val remainder = seconds % 60
        return if (hours > 0) "%d:%02d:%02d".format(hours, minutes, remainder)
        else "%02d:%02d".format(minutes, remainder)
    }

    fun formatPace(secondsPerKm: Double?): String {
        if (secondsPerKm == null || !secondsPerKm.isFinite()) return "--:--"
        val total = secondsPerKm.roundToInt().coerceAtLeast(0)
        return "%d:%02d".format(total / 60, total % 60)
    }
}
