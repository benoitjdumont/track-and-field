package com.gyrorider.trackandfield.tracking

import android.content.Context
import android.location.Location
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import kotlin.math.roundToInt

data class TrackStats(
    val distanceMeters: Double = 0.0,
    val durationMillis: Long = 0L,
    val averagePaceSecondsPerKm: Double? = null,
    val elevationGainMeters: Double = 0.0,
    val pointCount: Int = 0
)

/** Un repère posé sur le parcours : photo, vidéo, note écrite ou note vocale. */
data class Marker(
    val id: String,
    val type: String, // photo | video | note | voice
    val lat: Double,
    val lon: Double,
    val time: Long,
    val title: String,
    val text: String,
    val file: String // chemin du fichier, vide pour une note écrite
)

object TrackStore {
    const val STATE_IDLE = "idle"
    const val STATE_RECORDING = "recording"
    const val STATE_PAUSED = "paused"

    private const val PREFS = "track_and_field"
    private const val SETTINGS = "track_and_field_settings"
    private const val ACTIVE_POINTS = "active_points"
    private const val LAST_SEEN_TIME = "last_seen_time"
    private const val STATE = "state"
    private const val MARKERS = "markers"
    private const val NIGHT = "night"

    private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    // ---- état de l'enregistrement (survit à la fermeture de l'appli)
    fun state(context: Context): String = prefs(context).getString(STATE, STATE_IDLE) ?: STATE_IDLE
    fun setState(context: Context, state: String) = prefs(context).edit().putString(STATE, state).apply()

    fun append(context: Context, location: Location) {
        val prefs = prefs(context)
        // Le temps réel continue même à l'arrêt, sans ajouter de point GPS parasite.
        prefs.edit().putLong(LAST_SEEN_TIME, location.time).apply()
        // Une position trop imprécise (bâtiment, tunnel, premier verrouillage) fausse le tracé : on l'ignore.
        if (location.hasAccuracy() && location.accuracy > 40f) return
        val points = runCatching { JSONArray(prefs.getString(ACTIVE_POINTS, "[]")) }.getOrElse { JSONArray() }
        val previous = points.optJSONObject(points.length() - 1)
        if (previous != null) {
            val old = Location("stored").apply {
                latitude = previous.optDouble("lat")
                longitude = previous.optDouble("lon")
            }
            // Filtre la dérive GPS quand on est immobile.
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
        val raw = prefs(context).getString(ACTIVE_POINTS, "[]")
        return runCatching { JSONArray(raw) }.getOrElse { JSONArray() }
    }

    /** Dernière position connue du parcours (pour poser un repère). */
    fun lastPoint(context: Context): Pair<Double, Double>? {
        val points = currentPoints(context)
        val p = points.optJSONObject(points.length() - 1) ?: return null
        return p.optDouble("lat") to p.optDouble("lon")
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

        val latestObservedTime = prefs(context).getLong(LAST_SEEN_TIME, lastTime)
        val start = firstTime ?: 0L
        val duration = (maxOf(lastTime, latestObservedTime) - start).coerceAtLeast(0L)
        val pace = if (distance >= 100.0 && duration > 0L) duration / 1000.0 / (distance / 1000.0) else null
        return TrackStats(distance, duration, pace, elevationGain, points.length())
    }

    /** Efface le parcours et les repères : appelé seulement au départ d'une nouvelle sortie. */
    fun clear(context: Context) {
        prefs(context).edit().remove(ACTIVE_POINTS).remove(LAST_SEEN_TIME).remove(MARKERS).apply()
    }

    // ---- repères
    fun markers(context: Context): List<Marker> {
        val arr = runCatching { JSONArray(prefs(context).getString(MARKERS, "[]")) }.getOrElse { JSONArray() }
        return (0 until arr.length()).mapNotNull { i ->
            val o = arr.optJSONObject(i) ?: return@mapNotNull null
            Marker(
                id = o.optString("id"), type = o.optString("type"),
                lat = o.optDouble("lat"), lon = o.optDouble("lon"), time = o.optLong("time"),
                title = o.optString("title"), text = o.optString("text"), file = o.optString("file"),
            )
        }
    }

    fun addMarker(context: Context, m: Marker) {
        val arr = runCatching { JSONArray(prefs(context).getString(MARKERS, "[]")) }.getOrElse { JSONArray() }
        arr.put(JSONObject().apply {
            put("id", m.id); put("type", m.type); put("lat", m.lat); put("lon", m.lon); put("time", m.time)
            put("title", m.title); put("text", m.text); put("file", m.file)
        })
        prefs(context).edit().putString(MARKERS, arr.toString()).apply()
    }

    fun deleteMarker(context: Context, id: String) {
        val list = markers(context).filterNot { it.id == id }
        val arr = JSONArray()
        list.forEach { m ->
            arr.put(JSONObject().apply {
                put("id", m.id); put("type", m.type); put("lat", m.lat); put("lon", m.lon); put("time", m.time)
                put("title", m.title); put("text", m.text); put("file", m.file)
            })
        }
        prefs(context).edit().putString(MARKERS, arr.toString()).apply()
    }

    // ---- réglages
    /** "auto" (jour/nuit selon l'heure), "day" ou "night" */
    fun nightMode(context: Context): String =
        context.getSharedPreferences(SETTINGS, Context.MODE_PRIVATE).getString(NIGHT, "auto") ?: "auto"

    fun setNightMode(context: Context, mode: String) =
        context.getSharedPreferences(SETTINGS, Context.MODE_PRIVATE).edit().putString(NIGHT, mode).apply()

    // ---- export GPX 1.1
    fun gpx(context: Context): String {
        val points = currentPoints(context)
        val iso = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }
        val sb = StringBuilder()
        sb.append("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n")
        sb.append("<gpx version=\"1.1\" creator=\"Track &amp; Field\" xmlns=\"http://www.topografix.com/GPX/1/1\">\n")
        sb.append("  <trk><name>Track &amp; Field</name><trkseg>\n")
        for (i in 0 until points.length()) {
            val p = points.optJSONObject(i) ?: continue
            sb.append("    <trkpt lat=\"${p.optDouble("lat")}\" lon=\"${p.optDouble("lon")}\">")
            if (!p.isNull("alt")) sb.append("<ele>${p.optDouble("alt")}</ele>")
            sb.append("<time>${iso.format(Date(p.optLong("time")))}</time></trkpt>\n")
        }
        sb.append("  </trkseg></trk>\n</gpx>\n")
        return sb.toString()
    }

    // ---- affichage
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
