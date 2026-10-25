plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.vicimus.serialscanner"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.vicimus.serialscanner"
        minSdk = 28 // BluetoothHidDevice (keyboard mode) exists from Android 9 / API 28
        targetSdk = 35
        versionCode = 1
        versionName = "0.1"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            // Signed with the debug key so the APK installs directly; use a real key for distribution.
            signingConfig = signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.appcompat:appcompat:1.7.0")

    testImplementation("junit:junit:4.13.2")
}

/*
 * OFFLINE GUARD: the app must never be able to reach a network. After every manifest merge
 * (which includes permissions contributed by libraries), fail the build if the INTERNET
 * permission is present. Libraries that request it are stripped with tools:node="remove" in
 * src/main/AndroidManifest.xml; deleting that line, or adding the permission anywhere, breaks
 * the build here.
 */
val forbiddenPermissions = listOf("android.permission.INTERNET")

tasks.matching { it.name.startsWith("process") && it.name.endsWith("MainManifest") }
    .configureEach {
        doLast {
            val merged = outputs.files.asFileTree.matching { include("**/AndroidManifest.xml") }.files
            check(merged.isNotEmpty()) { "Offline guard: no merged manifest found for $name" }
            for (manifest in merged) {
                val text = manifest.readText()
                for (permission in forbiddenPermissions) {
                    val declared = Regex(
                        """<uses-permission(-sdk-23)?\s[^>]*android:name="${Regex.escape(permission)}"""",
                    ).containsMatchIn(text)
                    if (declared) {
                        throw GradleException(
                            "Offline guard: $permission is in the merged manifest ($manifest). " +
                                "This app must not have network access.",
                        )
                    }
                }
            }
        }
    }
