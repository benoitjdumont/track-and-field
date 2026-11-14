package com.gyrorider.trackandfield.tracking

import android.content.Context
import android.location.Location
import org.json.JSONArray
import org.json.JSONObject

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
        val raw = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(ACTIVE_POINTS, "[]")
        return runCatching { JSONArray(raw) }.getOrElse { JSONArray() }
    }

    fun clear(context: Context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(ACTIVE_POINTS).apply()
    }
}
