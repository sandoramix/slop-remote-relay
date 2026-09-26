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

    /** Updated on every window change, read by the executors and by device.status. */
    @Volatile
    var foregroundPackage: String? = null
        private set

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event?.eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) {
            // Ignore our own windows and the system UI, or the "current target"
            // in the controller flickers every time a notification appears.
            val pkg = event.packageName?.toString()
            if (pkg != null && pkg != packageName && pkg != "com.android.systemui") {
                foregroundPackage = pkg
            }
        }
    }

    override fun onInterrupt() = Unit

    override fun onDestroy() {
        if (instance === this) instance = null
        super.onDestroy()
    }

    companion object {
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
