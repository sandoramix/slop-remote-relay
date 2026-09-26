package com.relay.receiver.service

import android.accessibilityservice.AccessibilityService
import android.view.accessibility.AccessibilityEvent

/**
 * Provides two things: the accessibility tree of the foreground window, and
 * gesture dispatch. Both are needed only for fullscreen and for the imprecise
 * seek fallback — seeking through a media session does not touch this service.
 *
 * That separation is deliberate. On a device where accessibility is blocked
 * (Advanced Protection Mode, or Restricted Settings on a sideloaded build), the
 * receiver still seeks correctly; it just loses fullscreen.
 */
class RelayAccessibilityService : AccessibilityService() {

    @Volatile
    private var lastEventPackage: String? = null

    /**
     * The app in front, read by the executors and by device.status.
     *
     * The active window is asked first, because window-state events are not
     * guaranteed: an app brought back into an existing task by an intent can
     * come to the front without one, and a stale package here means the wrong
     * recipe runs. The last event is the fallback when our own window, the
     * system UI or the framework is the active one.
     */
    val foregroundPackage: String?
        get() {
            val active = runCatching { rootInActiveWindow?.packageName?.toString() }.getOrNull()
            return if (active != null && active != packageName && active !in IGNORED) active
            else lastEventPackage
        }

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event?.eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) {
            // Ignore our own windows and the system UI, or the "current target"
            // in the controller flickers every time a notification appears.
            val pkg = event.packageName?.toString()
            // "android" is the framework itself: the immersive-mode hint that
            // appears over a video the first time it goes fullscreen.
            if (pkg != null && pkg != packageName && pkg !in IGNORED) {
                lastEventPackage = pkg
            }
        }
    }

    override fun onInterrupt() = Unit

    override fun onDestroy() {
        if (instance === this) instance = null
        super.onDestroy()
    }

    companion object {
        private val IGNORED = setOf("com.android.systemui", "android")

        /**
         * The system owns this service's lifecycle, so a static handle is the
         * conventional way for the rest of the app to reach it. Null means the
         * user has not granted accessibility, which the chain handles gracefully.
         */
        @Volatile
        var instance: RelayAccessibilityService? = null
            private set
    }
}
