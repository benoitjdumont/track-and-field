package com.gyrorider.trackandfield.tracking

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority

class TrackingService : Service() {
    private val client by lazy { LocationServices.getFusedLocationProviderClient(this) }
    private var callback: LocationCallback? = null
    private var paused = false

    override fun onCreate() {
        super.onCreate()
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel(CHANNEL_ID, "Suivi GPS", NotificationManager.IMPORTANCE_LOW))
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> { paused = false; startForegroundCompat(); startLocationUpdates() }
            ACTION_PAUSE -> { paused = true; callback?.let(client::removeLocationUpdates); callback = null; startForegroundCompat("Suivi en pause") }
            ACTION_STOP -> { callback?.let(client::removeLocationUpdates); callback = null; stopForeground(STOP_FOREGROUND_REMOVE); stopSelf() }
        }
        return START_STICKY
    }

    private fun startForegroundCompat(text: String = "Enregistrement GPS en cours") {
        val notification = Notification.Builder(this, CHANNEL_ID)
            .setContentTitle("Track & Field")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setOngoing(true)
            .build()
        if (Build.VERSION.SDK_INT >=  Q) startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
        else startForeground(NOTIFICATION_ID, notification)
    }

    @Suppress("MissingPermission")
    private fun startLocationUpdates() {
        val request = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 2000L).setMinUpdateDistanceMeters(2f).build()
        callback = object : LocationCallback() {
            override fun onLocationResult(result: LocationResult) {
                // Next migration step persists each real GPS point and computes live stats.
                result.lastLocation ?: return
            }
        }
        client.requestLocationUpdates(request, callback!!, mainLooper)
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        const val ACTION_START = "com.gyrorider.trackandfield.START"
        const val ACTION_PAUSE = "com.gyrorider.trackandfield.PAUSE"
        const val ACTION_STOP = "com.gyrorider.trackandfield.STOP"
        private const val CHANNEL_ID = "track_gps"
        private const val NOTIFICATION_ID = 4101
    }
}
