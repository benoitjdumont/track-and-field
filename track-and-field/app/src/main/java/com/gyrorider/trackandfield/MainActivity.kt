package com.gyrorider.trackandfield

import android.Manifest
import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.MediaStore
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.Notes
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PhotoCamera
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material.icons.filled.Videocam
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import com.google.android.gms.location.LocationServices
import com.gyrorider.trackandfield.map.NativeRouteMap
import com.gyrorider.trackandfield.tracking.Marker
import com.gyrorider.trackandfield.tracking.Outing
import com.gyrorider.trackandfield.tracking.TrackStats
import com.gyrorider.trackandfield.tracking.TrackStore
import com.gyrorider.trackandfield.tracking.TrackingService
import com.gyrorider.trackandfield.ui.AccentBlue
import com.gyrorider.trackandfield.ui.MarkerDetailDialog
import com.gyrorider.trackandfield.ui.MarkerEditorDialog
import com.gyrorider.trackandfield.ui.Pill
import com.gyrorider.trackandfield.ui.RoundButton
import com.gyrorider.trackandfield.ui.VoiceNoteDialog
import com.gyrorider.trackandfield.ui.inkColor
import com.gyrorider.trackandfield.ui.panelColor
import com.gyrorider.trackandfield.ui.typeLabel
import kotlinx.coroutines.delay
import java.io.File
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import java.util.UUID

/** Un repère en cours de création (capture ou note). */
private data class Draft(
    val type: String,
    val file: File?,
    val lat: Double,
    val lon: Double,
    val showVoice: Boolean = false,
    val showEditor: Boolean = false
)

class MainActivity : ComponentActivity() {
    private var draft by mutableStateOf<Draft?>(null)

    private val permissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { }

    private val takePicture =
        registerForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
            val d = draft ?: return@registerForActivityResult
            draft = if (ok && d.file != null && d.file.length() > 0) d.copy(showEditor = true) else null
        }

    private val captureVideo =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            val d = draft ?: return@registerForActivityResult
            val ok = result.resultCode == RESULT_OK && d.file != null && d.file.length() > 0
            draft = if (ok) d.copy(showEditor = true) else null
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        requestLocationPermissions()
        setContent { Screen() }
    }

    // ---------------------------------------------------------------- permissions

    private fun requestLocationPermissions() {
        val permissions = mutableListOf(
            Manifest.permission.ACCESS_FINE_LOCATION,
            Manifest.permission.ACCESS_COARSE_LOCATION
        )
        if (Build.VERSION.SDK_INT >= 33) permissions += Manifest.permission.POST_NOTIFICATIONS
        if (permissions.any {
                ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
            }) {
            permissionLauncher.launch(permissions.toTypedArray())
        }
    }

    private fun hasLocation(): Boolean =
        ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED ||
            ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED

    // ---------------------------------------------------------------- suivi GPS

    private fun startTracking() {
        if (!hasLocation()) {
            requestLocationPermissions()
            return
        }
        ContextCompat.startForegroundService(
            this,
            Intent(this, TrackingService::class.java).setAction(TrackingService.ACTION_START)
        )
    }

    private fun sendTrackingAction(action: String) {
        startService(Intent(this, TrackingService::class.java).setAction(action))
    }

    // ---------------------------------------------------------------- position pour les repères

    @SuppressLint("MissingPermission")
    private fun locate(onFound: (Double, Double) -> Unit) {
        fun fallback() {
            val last = TrackStore.lastPoint(this)
            if (last != null) onFound(last.first, last.second)
            else toast("Position inconnue, réessayez.")
        }
        // pendant l'enregistrement, le repère se pose sur le dernier point du tracé
        if (TrackStore.state(this) != TrackStore.STATE_IDLE) return fallback()
        if (!hasLocation()) return fallback()
        LocationServices.getFusedLocationProviderClient(this).lastLocation
            .addOnSuccessListener { loc ->
                if (loc != null) onFound(loc.latitude, loc.longitude) else fallback()
            }
            .addOnFailureListener { fallback() }
    }

    // ---------------------------------------------------------------- capture

    private fun mediaFile(ext: String): File {
        val dir = File(filesDir, "media").apply { mkdirs() }
        return File(dir, "${System.currentTimeMillis()}.$ext")
    }

    private fun uriFor(file: File): Uri = FileProvider.getUriForFile(this, "$packageName.fileprovider", file)

    private fun startPhoto() = locate { lat, lon ->
        val file = mediaFile("jpg")
        draft = Draft("photo", file, lat, lon)
        takePicture.launch(uriFor(file))
    }

    private fun startVideo() = locate { lat, lon ->
        val file = mediaFile("mp4")
        val uri = uriFor(file)
        val intent = Intent(MediaStore.ACTION_VIDEO_CAPTURE)
            .putExtra(MediaStore.EXTRA_OUTPUT, uri)
            .putExtra(MediaStore.EXTRA_DURATION_LIMIT, 15)
            .addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION)
        intent.clipData = ClipData.newRawUri("", uri)
        if (intent.resolveActivity(packageManager) == null) {
            toast("Aucune appli caméra disponible.")
            return@locate
        }
        draft = Draft("video", file, lat, lon)
        captureVideo.launch(intent)
    }

    private fun startVoice() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            permissionLauncher.launch(arrayOf(Manifest.permission.RECORD_AUDIO))
            toast("Autorisez le micro, puis réessayez.")
            return
        }
        locate { lat, lon ->
            draft = Draft("voice", mediaFile("m4a"), lat, lon, showVoice = true)
        }
    }

    private fun startNote() = locate { lat, lon ->
        draft = Draft("note", null, lat, lon, showEditor = true)
    }

    private fun saveMarker(d: Draft, title: String, text: String) {
        TrackStore.addMarker(
            this,
            Marker(
                id = UUID.randomUUID().toString(),
                type = d.type,
                lat = d.lat,
                lon = d.lon,
                time = System.currentTimeMillis(),
                title = title,
                text = text,
                file = d.file?.absolutePath ?: ""
            )
        )
    }

    private fun discardDraft(d: Draft) {
        d.file?.delete()
        draft = null
    }

    private fun deleteMarker(m: Marker) {
        if (m.file.isNotBlank()) File(m.file).delete()
        TrackStore.deleteMarker(this, m.id)
    }

    private fun openMarkerFile(m: Marker) {
        if (m.file.isBlank()) return
        val mime = when (m.type) {
            "photo" -> "image/jpeg"
            "video" -> "video/mp4"
            "voice" -> "audio/mp4"
            else -> "*/*"
        }
        val uri = uriFor(File(m.file))
        val intent = Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, mime)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        try {
            startActivity(intent)
        } catch (e: ActivityNotFoundException) {
            toast("Aucune appli pour ouvrir ce fichier.")
        }
    }

    // ---------------------------------------------------------------- export GPX

    private fun exportCurrent() {
        if (TrackStore.routeCoordinates(this).isEmpty()) {
            toast("Aucun parcours à exporter.")
            return
        }
        exportGpx(TrackStore.gpx(this), "track-" + SimpleDateFormat("yyyyMMdd-HHmm", Locale.US).format(Date()))
    }

    private fun exportGpx(content: String, name: String) {
        val dir = File(cacheDir, "exports").apply { mkdirs() }
        val safe = name.replace(Regex("[^A-Za-z0-9_-]+"), "_").trim('_').ifBlank { "sortie" }
        val file = File(dir, "$safe.gpx")
        file.writeText(content)
        val uri = uriFor(file)
        val send = Intent(Intent.ACTION_SEND)
            .setType("application/gpx+xml")
            .putExtra(Intent.EXTRA_STREAM, uri)
            .putExtra(Intent.EXTRA_SUBJECT, file.name)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        send.clipData = ClipData.newRawUri("", uri)
        startActivity(Intent.createChooser(send, "Exporter le parcours"))
    }

    private fun defaultOutingName(): String =
        "Sortie " + SimpleDateFormat("d MMM HH:mm", Locale.getDefault()).format(Date())

    private fun toast(message: String) = Toast.makeText(this, message, Toast.LENGTH_SHORT).show()

    // ---------------------------------------------------------------- interface

    @OptIn(ExperimentalMaterial3Api::class)
    @Composable
    private fun Screen() {
        var state by remember { mutableStateOf(TrackStore.STATE_IDLE) }
        var stats by remember { mutableStateOf(TrackStats()) }
        var route by remember { mutableStateOf(emptyList<Pair<Double, Double>>()) }
        var markers by remember { mutableStateOf(emptyList<Marker>()) }
        var mode by remember { mutableStateOf(TrackStore.nightMode(this@MainActivity)) }
        var sheetOpen by remember { mutableStateOf(false) }
        var settingsOpen by remember { mutableStateOf(false) }
        var detail by remember { mutableStateOf<Marker?>(null) }
        var saveAsk by remember { mutableStateOf(false) }
        var outingsOpen by remember { mutableStateOf(false) }
        var outings by remember { mutableStateOf(emptyList<Outing>()) }
        var viewing by remember { mutableStateOf<Outing?>(null) }

        LaunchedEffect(Unit) {
            while (true) {
                state = TrackStore.state(this@MainActivity)
                stats = TrackStore.stats(this@MainActivity)
                route = TrackStore.routeCoordinates(this@MainActivity)
                markers = TrackStore.markers(this@MainActivity)
                delay(1000)
            }
        }

        val hour = Calendar.getInstance().get(Calendar.HOUR_OF_DAY)
        val night = when (mode) {
            "night" -> true
            "day" -> false
            else -> hour < 7 || hour >= 19
        }
        val recording = state == TrackStore.STATE_RECORDING
        val shownRoute = remember(viewing) { viewing?.let { TrackStore.coordinatesOf(it.pointsJson) } } ?: route
        val shownMarkers = viewing?.markers ?: markers
        val v = viewing
        LaunchedEffect(outingsOpen) {
            if (outingsOpen) outings = TrackStore.outings(this@MainActivity)
        }
        val paused = state == TrackStore.STATE_PAUSED
        val current = draft

        MaterialTheme(
            colorScheme = if (night) darkColorScheme(primary = AccentBlue) else lightColorScheme(primary = AccentBlue)
        ) {
            Box(Modifier.fillMaxSize()) {
                NativeRouteMap(
                    routePoints = shownRoute,
                    markers = shownMarkers,
                    night = night,
                    follow = recording && v == null,
                    onMarkerTap = { detail = it },
                    modifier = Modifier.fillMaxSize()
                )

                // barre du haut
                Row(
                    Modifier.fillMaxWidth().statusBarsPadding().padding(12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Pill("Track & Field", night) { }
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        RoundButton(night, onClick = { if (v != null) exportGpx(TrackStore.gpxOf(v.pointsJson), v.name) else exportCurrent() }) {
                            Icon(Icons.Default.Download, contentDescription = "Télécharger le GPX")
                        }
                        Pill("Paramètres", night, icon = { Icon(Icons.Default.Settings, contentDescription = null) }) {
                            settingsOpen = true
                        }
                    }
                }

                // bas : statistiques puis barre d'enregistrement
                Column(
                    Modifier.align(Alignment.BottomCenter).fillMaxWidth().navigationBarsPadding().padding(16.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    if (v != null) {
                        StatsStrip(
                            TrackStats(
                                distanceMeters = v.distanceMeters,
                                durationMillis = v.durationMillis,
                                averagePaceSecondsPerKm = if (v.distanceMeters >= 100.0 && v.durationMillis > 0L)
                                    v.durationMillis / 1000.0 / (v.distanceMeters / 1000.0) else null
                            ),
                            night
                        )
                        Pill("Retour à la carte", night, filled = true, icon = { Icon(Icons.Default.Close, contentDescription = null) }) {
                            viewing = null
                        }
                    } else {
                    if (recording || paused) StatsStrip(stats, night)
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        when {
                            recording -> {
                                Pill("Pause", night, icon = { Icon(Icons.Default.Pause, contentDescription = null) }) {
                                    sendTrackingAction(TrackingService.ACTION_PAUSE)
                                }
                                Pill("Terminer", night, icon = { Icon(Icons.Default.Stop, contentDescription = null) }) {
                                    sendTrackingAction(TrackingService.ACTION_STOP)
                                    if (TrackStore.currentPoints(this@MainActivity).length() > 0) saveAsk = true
                                }
                            }
                            paused -> {
                                Pill("Reprendre", night, filled = true, icon = { Icon(Icons.Default.PlayArrow, contentDescription = null) }) {
                                    startTracking()
                                }
                                Pill("Terminer", night, icon = { Icon(Icons.Default.Stop, contentDescription = null) }) {
                                    sendTrackingAction(TrackingService.ACTION_STOP)
                                    if (TrackStore.currentPoints(this@MainActivity).length() > 0) saveAsk = true
                                }
                            }
                            else -> {
                                Pill("Enregistrer", night, filled = true, icon = { Icon(Icons.Default.PlayArrow, contentDescription = null) }) {
                                    startTracking()
                                }
                            }
                        }
                        RoundButton(night, onClick = { sheetOpen = true }) {
                            Icon(Icons.Default.Add, contentDescription = "Ajouter un repère")
                        }
                    }
                    }
                }
            }
        }

        // menu « + »
        if (sheetOpen) {
            ModalBottomSheet(onDismissRequest = { sheetOpen = false }) {
                Column(Modifier.fillMaxWidth().navigationBarsPadding().padding(horizontal = 16.dp, vertical = 8.dp)) {
                    SheetItem("Photo", Icons.Default.PhotoCamera) { sheetOpen = false; startPhoto() }
                    SheetItem("Vidéo (15 s)", Icons.Default.Videocam) { sheetOpen = false; startVideo() }
                    SheetItem("Note vocale", Icons.Default.Mic) { sheetOpen = false; startVoice() }
                    SheetItem("Note écrite", Icons.Default.Notes) { sheetOpen = false; startNote() }
                    Spacer24()
                }
            }
        }

        // réglages
        if (settingsOpen) {
            AlertDialog(
                onDismissRequest = { settingsOpen = false },
                title = { Text("Réglages") },
                text = {
                    Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                        Text("Affichage de la carte", fontWeight = FontWeight.SemiBold)
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            listOf("auto" to "Auto", "day" to "Jour", "night" to "Nuit").forEach { (value, label) ->
                                FilterChip(
                                    selected = mode == value,
                                    onClick = {
                                        mode = value
                                        TrackStore.setNightMode(this@MainActivity, value)
                                    },
                                    label = { Text(label) }
                                )
                            }
                        }
                        OutlinedButton(onClick = { exportCurrent() }, modifier = Modifier.fillMaxWidth()) {
                            Icon(Icons.Default.Download, contentDescription = null)
                            Text(" Exporter le parcours (GPX)")
                        }
                        OutlinedButton(onClick = { settingsOpen = false; outingsOpen = true }, modifier = Modifier.fillMaxWidth()) {
                            Text("Mes sorties sauvegardées")
                        }
                    }
                },
                confirmButton = { TextButton(onClick = { settingsOpen = false }) { Text("Fermer") } }
            )
        }

        // capture : note vocale, puis titre et note du repère
        if (current != null) {
            if (current.showVoice && current.file != null) {
                VoiceNoteDialog(file = current.file) { path ->
                    draft = if (path == null) null else current.copy(showVoice = false, showEditor = true)
                }
            }
            if (current.showEditor) {
                MarkerEditorDialog(
                    defaultTitle = typeLabel(current.type),
                    showText = true,
                    onSave = { title, text ->
                        saveMarker(current, title, text)
                        draft = null
                    },
                    onCancel = { discardDraft(current) }
                )
            }
        }

        // garder la sortie après « Terminer »
        if (saveAsk) {
            var name by remember { mutableStateOf(defaultOutingName()) }
            AlertDialog(
                onDismissRequest = { saveAsk = false },
                title = { Text("Garder cette sortie ?") },
                text = {
                    OutlinedTextField(
                        value = name,
                        onValueChange = { name = it },
                        label = { Text("Nom") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                },
                confirmButton = {
                    Button(onClick = {
                        val ok = TrackStore.saveOuting(this@MainActivity, name.trim().ifBlank { defaultOutingName() })
                        saveAsk = false
                        toast(if (ok) "Sortie sauvegardée." else "Rien à sauvegarder.")
                    }) { Text("Sauvegarder") }
                },
                dismissButton = { TextButton(onClick = { saveAsk = false }) { Text("Pas maintenant") } }
            )
        }

        // liste des sorties sauvegardées
        if (outingsOpen) {
            ModalBottomSheet(onDismissRequest = { outingsOpen = false }) {
                Column(
                    Modifier.fillMaxWidth().navigationBarsPadding().padding(16.dp).verticalScroll(rememberScrollState()),
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    Text("Mes sorties", fontSize = 20.sp, fontWeight = FontWeight.Bold)
                    if (outings.isEmpty()) {
                        Text("Aucune sortie sauvegardée. Appuyez sur Terminer, puis Sauvegarder.")
                    }
                    outings.forEach { o ->
                        Column(
                            Modifier.fillMaxWidth()
                                .background(panelColor(night), RoundedCornerShape(16.dp))
                                .padding(12.dp),
                            verticalArrangement = Arrangement.spacedBy(4.dp)
                        ) {
                            Text(o.name, fontWeight = FontWeight.Bold)
                            Text(
                                "${SimpleDateFormat("d MMM yyyy HH:mm", Locale.getDefault()).format(Date(o.time))} · " +
                                    "%.2f km · ".format(o.distanceMeters / 1000.0) +
                                    "${TrackStore.formatDuration(o.durationMillis)} · ${o.markers.size} repère(s)",
                                fontSize = 12.sp
                            )
                            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                                TextButton(onClick = { viewing = o; outingsOpen = false }) { Text("Voir") }
                                TextButton(onClick = { exportGpx(TrackStore.gpxOf(o.pointsJson), o.name) }) { Text("GPX") }
                                TextButton(onClick = {
                                    if (viewing?.id == o.id) viewing = null
                                    TrackStore.deleteOuting(this@MainActivity, o.id)
                                    outings = TrackStore.outings(this@MainActivity)
                                }) { Text("Supprimer") }
                            }
                        }
                    }
                    Box(Modifier.height(24.dp))
                }
            }
        }

        // détail d'un repère
        detail?.let { m ->
            MarkerDetailDialog(
                marker = m,
                onOpen = { openMarkerFile(m) },
                onDelete = {
                    deleteMarker(m)
                    detail = null
                },
                onClose = { detail = null }
            )
        }
    }

    @Composable
    private fun SheetItem(label: String, icon: androidx.compose.ui.graphics.vector.ImageVector, onClick: () -> Unit) {
        TextButton(onClick = onClick, modifier = Modifier.fillMaxWidth()) {
            Icon(icon, contentDescription = null)
            Text("  $label", fontSize = 16.sp)
        }
    }

    @Composable
    private fun Spacer24() = Box(Modifier.height(24.dp))

    @Composable
    private fun StatsStrip(stats: TrackStats, night: Boolean) {
        Surface(
            shape = RoundedCornerShape(22.dp),
            color = panelColor(night).copy(alpha = 0.95f),
            shadowElevation = 6.dp
        ) {
            Row(
                Modifier.padding(horizontal = 18.dp, vertical = 10.dp),
                horizontalArrangement = Arrangement.spacedBy(20.dp)
            ) {
                StatCell("Distance", "%.2f km".format(stats.distanceMeters / 1000.0), night)
                StatCell("Durée", TrackStore.formatDuration(stats.durationMillis), night)
                StatCell("Allure", "${TrackStore.formatPace(stats.averagePaceSecondsPerKm)} /km", night)
            }
        }
    }

    @Composable
    private fun StatCell(label: String, value: String, night: Boolean) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(label, fontSize = 11.sp, color = inkColor(night).copy(alpha = 0.7f))
            Text(value, fontSize = 16.sp, fontWeight = FontWeight.Bold, color = inkColor(night))
        }
    }
}
