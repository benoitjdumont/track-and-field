plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "com.gyrorider.trackandfield"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.gyrorider.trackandfield"
        minSdk = 26
        targetSdk = 35
        versionCode = (project.findProperty("vCode") as String?)?.toIntOrNull() ?: 1
        versionName = "0.2.${versionCode}"
    }

    // clé de signature fixe : sans elle, Android refuse d'installer une version par-dessus la précédente
    signingConfigs {
        create("fixed") {
            storeFile = file("trackandfield.jks")
            storePassword = "trackandfield-sideload"
            keyAlias = "trackandfield"
            keyPassword = "trackandfield-sideload"
        }
    }

    buildTypes {
        debug { signingConfig = signingConfigs.getByName("fixed") }
    }

    buildFeatures { compose = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    implementation(platform("androidx.compose:compose-bom:2024.12.01"))
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
    implementation("com.google.android.gms:play-services-location:21.3.0")
    implementation("org.maplibre.gl:android-sdk:13.7.1")
    implementation("androidx.datastore:datastore-preferences:1.1.1")
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    debugImplementation("androidx.compose.ui:ui-tooling")
}
