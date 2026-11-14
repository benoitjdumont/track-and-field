package com.gyrorider.trackandfield.map

import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import org.maplibre.android.MapLibre
import org.maplibre.android.camera.CameraPosition
import org.maplibre.android.geometry.LatLng
import org.maplibre.android.maps.MapLibreMap
import org.maplibre.android.maps.MapView
import org.maplibre.android.style.layers.LineLayer
import org.maplibre.android.style.layers.PropertyFactory
import org.maplibre.android.style.sources.GeoJsonSource
import org.maplibre.geojson.Feature
import org.maplibre.geojson.FeatureCollection
import org.maplibre.geojson.LineString
import org.maplibre.geojson.Point

private const val OPENFREEMAP_STYLE = "https://tiles.openfreemap.org/styles/liberty"
private const val ROUTE_SOURCE_ID = "recorded-route-source"
private const val ROUTE_LAYER_ID = "recorded-route-line"

@Composable
fun NativeRouteMap(
    routePoints: List<Pair<Double, Double>>,
    modifier: Modifier = Modifier
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val activeMap = remember { mutableStateOf<MapLibreMap?>(null) }
    val mapReady = remember { mutableStateOf(false) }

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
            activeMap.value = null
            mapReady.value = false
            mapView.onDestroy()
        }
    }

    AndroidView(modifier = modifier, factory = { mapView })

    LaunchedEffect(mapView) {
        mapView.getMapAsync { map ->
            activeMap.value = map
            map.setStyle(OPENFREEMAP_STYLE) { style ->
                map.cameraPosition = CameraPosition.Builder()
                    .target(LatLng(45.5019, -73.5674))
                    .zoom(10.5)
                    .build()
                if (style.getSource(ROUTE_SOURCE_ID) == null) {
                    style.addSource(GeoJsonSource(ROUTE_SOURCE_ID))
                }
                if (style.getLayer(ROUTE_LAYER_ID) == null) {
                    style.addLayer(
                        LineLayer(ROUTE_LAYER_ID, ROUTE_SOURCE_ID).withProperties(
                            PropertyFactory.lineColor("#287FC2"),
                            PropertyFactory.lineWidth(5f),
                            PropertyFactory.lineCap("round"),
                            PropertyFactory.lineJoin("round")
                        )
                    )
                }
                mapReady.value = true
                renderRoute(map, routePoints)
            }
        }
    }

    LaunchedEffect(routePoints, mapReady.value) {
        if (mapReady.value) {
            activeMap.value?.let { map -> renderRoute(map, routePoints) }
        }
    }
}

private fun renderRoute(map: MapLibreMap, coordinates: List<Pair<Double, Double>>) {
    val points = coordinates.map { (latitude, longitude) ->
        Point.fromLngLat(longitude, latitude)
    }
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
