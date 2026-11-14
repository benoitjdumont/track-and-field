package com.gyrorider.trackandfield

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import com.gyrorider.trackandfield.tracking.TrackingService

private val PaleBlue = Color(0xFFEAF5FF)
private val AccentBlue = Color(0xFF287FC2)
private val Ink = Color(0xFF172B3A)

class MainActivity : ComponentActivity() {
    private val permissionLauncher = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        requestLocationPermissions()
        setContent { TrackAndFieldScreen(
            onStart = { startTracking() },
            onPause = { stopService(Intent(this, TrackingService::class.java).setAction(TrackingService.ACTION_PAUSE)) },
            onStop = { stopService(Intent(this, TrackingService::class.java).setAction(TrackingService.ACTION_STOP)) }
        ) }
    }
    private fun requestLocationPermissions() {
        val permissions = mutableListOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)
        if (Build.VERSION.SDK_INT >= 33) permissions += Manifest.permission.POST_NOTIFICATIONS
        if (permissions.any { ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED }) permissionLauncher.launch(permissions.toTypedArray())
    }
    private fun startTracking() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
            ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
            ContextCompat.startForegroundService(this, Intent(this, TrackingService::class.java).setAction(TrackingService.ACTION_START))
        } else requestLocationPermissions()
    }
}

@Composable
private fun TrackAndFieldScreen(onStart: () -> Unit, onPause: () -> Unit, onStop: () -> Unit) {
    var started by remember { mutableStateOf(false) }
    MaterialTheme(colorScheme = lightColorScheme(primary = AccentBlue, background = PaleBlue, surface = Color.White)) {
        Surface(Modifier.fillMaxSize(), color = PaleBlue) {
            Column(Modifier.fillMaxSize().padding(20.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
                Text("Track & Field", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold, color = Ink)
                Text("Suivez vos sorties. Gardez chaque moment.", color = Ink)
                Card(shape = RoundedCornerShape(28.dp), colors = CardDefaults.cardColors(containerColor = Color.White), modifier = Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Default.LocationOn, contentDescription = null, tint = AccentBlue)
                            Text("  Suivi GPS", fontWeight = FontWeight.SemiBold, color = Ink)
                        }
                        Text(if (started) "Enregistrement actif en arrière-plan" else "Prêt pour une nouvelle sortie", color = Ink)
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Button(onClick = { started = true; onStart() }, modifier = Modifier.weight(1f)) { Icon(Icons.Default.PlayArrow, null); Text(" Démarrer") }
                            OutlinedButton(onClick = onPause, modifier = Modifier.weight(1f)) { Icon(Icons.Default.Pause, null); Text(" Pause") }
                        }
                        OutlinedButton(onClick = { started = false; onStop() }, modifier = Modifier.fillMaxWidth()) { Icon(Icons.Default.Stop, null); Text(" Terminer") }
                    }
                }
                Card(shape = RoundedCornerShape(28.dp), colors = CardDefaults.cardColors(containerColor = Color.White), modifier = Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(20.dp)) {
                        Text("Votre activité", fontWeight = FontWeight.Bold, color = Ink)
                        Spacer(Modifier.height(8.dp))
                        Text("Distance  —     Durée  —     Allure  —", color = Ink)
                        Text("Les statistiques en direct seront reliées au moteur GPS dans la prochaine étape.", style = MaterialTheme.typography.bodySmall, color = Color.Gray)
                    }
                }
                Card(shape = RoundedCornerShape(28.dp), colors = CardDefaults.cardColors(containerColor = Color.White), modifier = Modifier.fillMaxWidth().weight(1f)) {
                    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        Text("Carte et parcours GPS
Intégration cartographique native en cours", color = AccentBlue)
                    }
                }
            }
        }
    }
}
