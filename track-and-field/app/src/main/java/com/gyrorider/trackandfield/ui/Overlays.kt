package com.gyrorider.trackandfield.ui

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.MediaRecorder
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.Notes
import androidx.compose.material.icons.filled.PhotoCamera
import androidx.compose.material.icons.filled.Videocam
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.Button
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.layout
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.gyrorider.trackandfield.tracking.Marker
import kotlinx.coroutines.delay
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.math.roundToInt

val AccentBlue = Color(0xFF287FC2)
val InkLight = Color(0xFF172B3A)
val PanelNight = Color(0xFF1E2A36)

fun panelColor(night: Boolean) = if (night) PanelNight else Color.White
fun inkColor(night: Boolean) = if (night) Color.White else InkLight

/** Bouton « pilule » : texte sur une seule ligne, jamais coupé. */
@Composable
fun Pill(
    text: String,
    night: Boolean,
    modifier: Modifier = Modifier,
    filled: Boolean = false,
    icon: (@Composable () -> Unit)? = null,
    onClick: () -> Unit
) {
    val bg = when {
        filled -> AccentBlue
        else -> panelColor(night).copy(alpha = 0.95f)
    }
    val ink = if (filled) Color.White else inkColor(night)
    Row(
        modifier
            .clip(RoundedCornerShape(26.dp))
            .background(bg)
            .clickable(onClick = onClick)
            .padding(horizontal = 18.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        if (icon != null) {
            Box(Modifier.size(20.dp), contentAlignment = Alignment.Center) {
                androidx.compose.runtime.CompositionLocalProvider(
                    androidx.compose.material3.LocalContentColor provides ink
                ) { icon() }
            }
            Spacer(Modifier.width(8.dp))
        }
        Text(text, color = ink, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, softWrap = false)
    }
}

/** Bouton rond (la « + » par exemple). */
@Composable
fun RoundButton(night: Boolean, onClick: () -> Unit, content: @Composable () -> Unit) {
    Surface(
        shape = CircleShape,
        color = panelColor(night),
        shadowElevation = 6.dp,
        modifier = Modifier.size(56.dp).clickable(onClick = onClick)
    ) {
        Box(contentAlignment = Alignment.Center) {
            androidx.compose.runtime.CompositionLocalProvider(
                androidx.compose.material3.LocalContentColor provides inkColor(night)
            ) { content() }
        }
    }
}

/** Repère : grosse épingle + bulle au-dessus. Positionné sur (x, y) en pixels de l'écran. */
@Composable
fun MarkerBubble(marker: Marker, x: Float, y: Float, night: Boolean, onTap: () -> Unit) {
    val thumb = remember(marker.file, marker.type) {
        if (marker.type == "photo" && marker.file.isNotBlank()) decodeThumb(marker.file, 160) else null
    }
    Column(
        Modifier.anchorAt(x, y).clickable(onClick = onTap),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Surface(
            shape = RoundedCornerShape(14.dp),
            color = panelColor(night),
            shadowElevation = 6.dp,
            modifier = Modifier.width(190.dp)
        ) {
            Row(Modifier.padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
                if (thumb != null) {
                    Image(
                        bitmap = thumb.asImageBitmap(),
                        contentDescription = null,
                        contentScale = ContentScale.Crop,
                        modifier = Modifier.size(52.dp).clip(RoundedCornerShape(8.dp))
                    )
                    Spacer(Modifier.width(8.dp))
                }
                Column(Modifier.weight(1f)) {
                    Text(
                        marker.title.ifBlank { typeLabel(marker.type) },
                        color = inkColor(night), fontWeight = FontWeight.Bold, fontSize = 14.sp,
                        maxLines = 1, overflow = TextOverflow.Ellipsis
                    )
                    if (marker.text.isNotBlank()) {
                        Text(
                            marker.text, color = inkColor(night).copy(alpha = 0.8f), fontSize = 12.sp,
                            maxLines = 2, overflow = TextOverflow.Ellipsis
                        )
                    }
                }
            }
        }
        // petite pointe de la bulle
        Canvas(Modifier.size(14.dp, 8.dp)) {
            val path = Path().apply {
                moveTo(0f, 0f); lineTo(size.width, 0f); lineTo(size.width / 2f, size.height); close()
            }
            drawPath(path, panelColor(night))
        }
        // l'épingle
        Surface(shape = CircleShape, color = AccentBlue, shadowElevation = 6.dp, modifier = Modifier.size(46.dp)) {
            Box(contentAlignment = Alignment.Center) {
                Icon(iconFor(marker.type), contentDescription = null, tint = Color.White, modifier = Modifier.size(24.dp))
            }
        }
    }
}

/** Place le composable pour que son bas-centre tombe sur (x, y), sans réduire sa zone de toucher. */
private fun Modifier.anchorAt(x: Float, y: Float): Modifier = this.layout { measurable, constraints ->
    val p = measurable.measure(constraints)
    layout(p.width, p.height) {
        p.place((x - p.width / 2f).roundToInt(), (y - p.height).roundToInt())
    }
}

fun iconFor(type: String) = when (type) {
    "photo" -> Icons.Default.PhotoCamera
    "video" -> Icons.Default.Videocam
    "voice" -> Icons.Default.Mic
    else -> Icons.Default.Notes
}

fun typeLabel(type: String) = when (type) {
    "photo" -> "Photo"
    "video" -> "Vidéo"
    "voice" -> "Note vocale"
    else -> "Note"
}

fun decodeThumb(path: String, max: Int): Bitmap? = runCatching {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(path, bounds)
    var sample = 1
    while (bounds.outWidth / sample > max * 2 || bounds.outHeight / sample > max * 2) sample *= 2
    BitmapFactory.decodeFile(path, BitmapFactory.Options().apply { inSampleSize = sample })
}.getOrNull()

/** Dialogue pour donner un titre et une note à un repère. */
@Composable
fun MarkerEditorDialog(
    defaultTitle: String,
    showText: Boolean,
    onSave: (title: String, text: String) -> Unit,
    onCancel: () -> Unit
) {
    var title by remember { mutableStateOf(defaultTitle) }
    var text by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onCancel,
        title = { Text("Ajouter un repère") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(title, { title = it }, label = { Text("Titre") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                if (showText) {
                    OutlinedTextField(text, { text = it }, label = { Text("Note") }, modifier = Modifier.fillMaxWidth(), minLines = 2)
                }
            }
        },
        confirmButton = { Button(onClick = { onSave(title.trim(), text.trim()) }) { Text("Enregistrer") } },
        dismissButton = { TextButton(onClick = onCancel) { Text("Annuler") } }
    )
}

/** Enregistre une note vocale tant que la fenêtre est ouverte. */
@Composable
fun VoiceNoteDialog(file: File, onDone: (String?) -> Unit) {
    var recorder by remember { mutableStateOf<MediaRecorder?>(null) }
    var seconds by remember { mutableIntStateOf(0) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        try {
            recorder = startVoice(file)
        } catch (e: Exception) {
            error = "Micro indisponible."
        }
    }
    LaunchedEffect(recorder) {
        while (recorder != null) {
            delay(1000)
            seconds++
        }
    }

    AlertDialog(
        onDismissRequest = {
            stopVoice(recorder, file, keep = false)
            recorder = null
            onDone(null)
        },
        title = { Text("Note vocale") },
        text = { Text(error ?: "Enregistrement… %02d:%02d".format(seconds / 60, seconds % 60)) },
        confirmButton = {
            Button(
                enabled = recorder != null,
                onClick = {
                    stopVoice(recorder, file, keep = true)
                    recorder = null
                    onDone(file.absolutePath)
                }
            ) { Text("Arrêter") }
        },
        dismissButton = {
            TextButton(onClick = {
                stopVoice(recorder, file, keep = false)
                recorder = null
                onDone(null)
            }) { Text("Annuler") }
        }
    )
}

@Suppress("DEPRECATION")
private fun startVoice(file: File): MediaRecorder {
    file.parentFile?.mkdirs()
    return MediaRecorder().apply {
        setAudioSource(MediaRecorder.AudioSource.MIC)
        setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
        setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
        setOutputFile(file.absolutePath)
        prepare()
        start()
    }
}

private fun stopVoice(recorder: MediaRecorder?, file: File, keep: Boolean) {
    if (recorder != null) {
        runCatching { recorder.stop() }
        runCatching { recorder.release() }
    }
    if (!keep) file.delete()
}

/** Détail d'un repère : ouvrir le fichier ou supprimer. */
@Composable
fun MarkerDetailDialog(marker: Marker, onOpen: () -> Unit, onDelete: () -> Unit, onClose: () -> Unit) {
    val time = SimpleDateFormat("d MMM HH:mm", Locale.getDefault()).format(Date(marker.time))
    AlertDialog(
        onDismissRequest = onClose,
        title = { Text(marker.title.ifBlank { typeLabel(marker.type) }) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text("${typeLabel(marker.type)} · $time", fontSize = 12.sp)
                if (marker.text.isNotBlank()) Text(marker.text)
            }
        },
        confirmButton = {
            if (marker.file.isNotBlank()) TextButton(onClick = onOpen) { Text("Ouvrir") }
            else TextButton(onClick = onClose) { Text("Fermer") }
        },
        dismissButton = { TextButton(onClick = onDelete) { Text("Supprimer") } }
    )
}
