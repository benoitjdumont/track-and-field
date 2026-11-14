package com.gyrorider.trackandfield.map

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.gyrorider.trackandfield.tracking.Marker
import com.gyrorider.trackandfield.ui.MarkerBubble
import org.maplibre.android.MapLibre
import org.maplibre.android.camera.CameraPosition
import org.maplibre.android.camera.CameraUpdateFactory
import org.maplibre.android.geometry.LatLng
import org.maplibre.android.maps.MapLibreMap
import org.maplibre.android.maps.MapView
import org.maplibre.android.maps.Style
import org.maplibre.android.style.layers.LineLayer
import org.maplibre.android.style.layers.PropertyFactory
import org.maplibre.android.style.sources.GeoJsonSource
import org.maplibre.geojson.Feature
import org.maplibre.geojson.FeatureCollection
import org.maplibre.geojson.LineString
import org.maplibre.geojson.Point

private const val STYLE_DAY = "https://tiles.openfreemap.org/styles/liberty"
private const val STYLE_NIGHT = "https://tiles.openfreemap.org/styles/dark"
private const val ROUTE_SOURCE_ID = "recorded-route-source"
private const val ROUTE_LAYER_ID = "recorded-route-line"

/**
 * Carte plein écran. Dessine le parcours et laisse Compose poser les repères
 * (épingles + bulles) par-dessus, à la bonne position sur l'écran.
 */
@Composable
fun NativeRouteMap(
    routePoints: List<Pair<Double, Double>>,
    markers: List<Marker>,
    night: Boolean,
    follow: Boolean,
    onMarkerTap: (Marker) -> Unit,
    modifier: Modifier = Modifier
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val mapState = remember { mutableStateOf<MapLibreMap?>(null) }
    val styleUrl = if (night) STYLE_NIGHT else STYLE_DAY
    // incrémenté à chaque déplacement de la carte : force Compose à replacer les repères
    var camTick by remember { mutableIntStateOf(0) }

    val mapView = remember(context) {
        MapLibre.getInstance(context)
        MapView(context).apply { onCreate(null) }
    }

    DisposableEffect(lifecycleOwner, mapView) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_START -> mapView.onStart()
                Lifecycle.Event.ON_RESUME -> mapView.onResume()
                Lifecycle.Event.ON_PAUSE -> mapView.onPause()
                Lifecycle.Event.ON_STOP -> mapView.onStop()
                else -> Unit
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose {
            lifecycleOwner.lifecycle.removeObserver(observer)
            mapState.value = null
            mapView.onDestroy()
        }
    }

    LaunchedEffect(mapView) {
        mapView.getMapAsync { map ->
            mapState.value = map
            map.cameraPosition = CameraPosition.Builder().target(LatLng(45.5019, -73.5674)).zoom(14.0).build()
            map.addOnCameraMoveListener { camTick++ }
            loadStyle(map, styleUrl, routePoints)
        }
    }

    // changement de style jour / nuit
    LaunchedEffect(night) {
        mapState.value?.let { map -> loadStyle(map, styleUrl, routePoints) }
    }

    LaunchedEffect(routePoints) {
        mapState.value?.let { map -> renderRoute(map, routePoints) }
        // pendant l'enregistrement, la carte suit la position
        val last = routePoints.lastOrNull()
        if (follow && last != null) {
            mapState.value?.animateCamera(CameraUpdateFactory.newLatLng(LatLng(last.first, last.second)), 600)
        }
    }

    Box(modifier.fillMaxSize()) {
        AndroidView(modifier = Modifier.fillMaxSize(), factory = { mapView })
        // repères : lus à chaque déplacement de carte
        val map = mapState.value
        if (map != null) {
            @Suppress("UNUSED_EXPRESSION") camTick
            markers.forEach { m ->
                val p = map.projection.toScreenLocation(LatLng(m.lat, m.lon))
                MarkerBubble(
                    marker = m,
                    x = p.x,
                    y = p.y,
                    night = night,
                    onTap = { onMarkerTap(m) }
                )
            }
        }
    }
}

private fun loadStyle(map: MapLibreMap, url: String, routePoints: List<Pair<Double, Double>>) {
    map.setStyle(url) { style ->
        ensureRouteLayers(style)
        renderRoute(map, routePoints)
    }
}

private fun ensureRouteLayers(style: Style) {
    if (style.getSource(ROUTE_SOURCE_ID) == null) style.addSource(GeoJsonSource(ROUTE_SOURCE_ID))
    if (style.getLayer(ROUTE_LAYER_ID) == null) {
        style.addLayer(
            LineLayer(ROUTE_LAYER_ID, ROUTE_SOURCE_ID).withProperties(
                PropertyFactory.lineColor("#287FC2"),
                PropertyFactory.lineWidth(6f),
                PropertyFactory.lineCap("round"),
                PropertyFactory.lineJoin("round")
            )
        )
    }
}

private fun renderRoute(map: MapLibreMap, coordinates: List<Pair<Double, Double>>) {
    val points = coordinates.map { (latitude, longitude) -> Point.fromLngLat(longitude, latitude) }
    val features = if (points.size >= 2) {
        arrayOf(Feature.fromGeometry(LineString.fromLngLats(points)))
    } else {
        emptyArray()
    }
    val collection = FeatureCollection.fromFeatures(features)
    map.getStyle { style ->
        style.getSourceAs<GeoJsonSource>(ROUTE_SOURCE_ID)?.setGeoJson(collection)
    }
}
