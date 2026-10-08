package com.relay.receiver.core

import android.content.Context
import android.content.res.Configuration
import com.relay.receiver.service.RelayForegroundService
import java.util.Locale

/** Languages the receiver ships strings for. The first one is the default. */
val SUPPORTED_LANGUAGES = listOf("en", "it")

/** The language chosen in the app; English unless the user picked otherwise, whatever the phone says. */
fun Context.chosenLanguage(): String {
    val saved = getSharedPreferences(RelayForegroundService.PREFS, Context.MODE_PRIVATE)
        .getString(RelayForegroundService.KEY_LANGUAGE, null)
    return if (saved in SUPPORTED_LANGUAGES) saved!! else SUPPORTED_LANGUAGES.first()
}

/**
 * This context with the in-app language applied. Use it in attachBaseContext
 * and wherever a string is resolved outside an activity (service, executors).
 */
fun Context.localized(): Context {
    val config = Configuration(resources.configuration)
    config.setLocale(Locale(chosenLanguage()))
    return createConfigurationContext(config)
}

/** Resolves a string in the in-app language, reading the preference each time so a change applies live. */
fun Context.str(id: Int, vararg args: Any): String = localized().getString(id, *args)
