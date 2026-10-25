package com.vicimus.serialscanner.hid

import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothHidDevice
import android.bluetooth.BluetoothHidDeviceAppSdpSettings
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.content.Context
import android.os.Handler
import android.os.Looper
import java.util.concurrent.Executors

/** What the keyboard is doing, for the status line. */
sealed interface KeyboardState {
    data object Starting : KeyboardState
    data object BluetoothOff : KeyboardState

    /** The phone cannot act as a Bluetooth keyboard (no HID Device profile, or it is blocked). */
    data object Unsupported : KeyboardState

    /** Registered as a keyboard; no computer connected. */
    data object NotConnected : KeyboardState

    /** Keyboard mode was taken over or stopped (e.g. another keyboard app registered). */
    data object Stopped : KeyboardState
    data class Connected(val computerName: String) : KeyboardState
}

/**
 * The phone as a Bluetooth keyboard (Android BluetoothHidDevice, API 28+). The computer pairs with
 * it like any Bluetooth keyboard and needs no extra software. Typing sends one key at a time with
 * a short pause, and only A-Z / 0-9 (see [KeyMap]) - never Enter.
 *
 * Permissions (BLUETOOTH_CONNECT on Android 12+) are checked by the activity before [start].
 */
@SuppressLint("MissingPermission")
class HidKeyboard(
    context: Context,
    private val onState: (KeyboardState) -> Unit,
) {
    private val appContext = context.applicationContext
    private val adapter: BluetoothAdapter? =
        appContext.getSystemService(BluetoothManager::class.java)?.adapter
    private val prefs = appContext.getSharedPreferences("keyboard", Context.MODE_PRIVATE)
    private val main = Handler(Looper.getMainLooper())

    /** Bluetooth callbacks and typing run here, one thing at a time. */
    private val worker = Executors.newSingleThreadExecutor()

    private var hid: BluetoothHidDevice? = null
    private var host: BluetoothDevice? = null
    private var registered = false

    var state: KeyboardState = KeyboardState.Starting
        private set

    val isConnected: Boolean get() = host != null

    fun start() {
        val bt = adapter
        if (bt == null) return publish(KeyboardState.Unsupported)
        if (!bt.isEnabled) return publish(KeyboardState.BluetoothOff)
        publish(KeyboardState.Starting)
        val requested = bt.getProfileProxy(appContext, profileListener, BluetoothProfile.HID_DEVICE)
        if (!requested) return publish(KeyboardState.Unsupported)
        // Some phones accept the request but never deliver the profile (vendor builds that strip
        // HID Device): treat "no registration within a few seconds" as unsupported.
        main.postDelayed(registrationTimeout, REGISTRATION_TIMEOUT_MS)
    }

    fun stop() {
        main.removeCallbacks(registrationTimeout)
        hid?.let { proxy ->
            runCatching { proxy.unregisterApp() }
            adapter?.closeProfileProxy(BluetoothProfile.HID_DEVICE, proxy)
        }
        hid = null
        host = null
        registered = false
        worker.shutdown()
    }

    /** Computers this phone is paired with, for "Connect to computer". */
    fun pairedDevices(): List<BluetoothDevice> = adapter?.bondedDevices.orEmpty().sortedBy {
        // computers first, then by name
        val isComputer = it.bluetoothClass?.majorDeviceClass == android.bluetooth.BluetoothClass.Device.Major.COMPUTER
        (if (isComputer) "0" else "1") + displayName(it)
    }

    fun connect(device: BluetoothDevice) {
        hid?.connect(device)
    }

    fun displayName(device: BluetoothDevice): String = device.name ?: device.address

    /**
     * Types [text] into whatever has focus on the connected computer. Calls [onDone] on the main
     * thread with false if nothing could be sent (not connected, or a character is not A-Z/0-9).
     */
    fun type(text: String, onDone: (Boolean) -> Unit) {
        val target = host
        val proxy = hid
        val reports = KeyMap.reportsFor(text)
        if (target == null || proxy == null || reports == null) {
            onDone(false)
            return
        }
        worker.execute {
            var ok = true
            for (report in reports) {
                ok = proxy.sendReport(target, KeyMap.REPORT_ID, report) && ok
                Thread.sleep(KEY_DELAY_MS)
            }
            // Never leave a key held down, even if a send failed part-way.
            proxy.sendReport(target, KeyMap.REPORT_ID, KeyMap.releaseReport())
            main.post { onDone(ok) }
        }
    }

    private val registrationTimeout = Runnable {
        if (!registered) publish(KeyboardState.Unsupported)
    }

    private val profileListener = object : BluetoothProfile.ServiceListener {
        override fun onServiceConnected(profile: Int, proxy: BluetoothProfile) {
            if (profile != BluetoothProfile.HID_DEVICE) return
            val device = proxy as BluetoothHidDevice
            hid = device
            val sdp = BluetoothHidDeviceAppSdpSettings(
                "Serial Scanner",
                "Types scanned serials",
                "VICIMUS",
                BluetoothHidDevice.SUBCLASS1_KEYBOARD,
                HidDescriptor.KEYBOARD,
            )
            val accepted = device.registerApp(sdp, null, null, worker, callback)
            if (!accepted) main.post { publish(KeyboardState.Unsupported) }
        }

        override fun onServiceDisconnected(profile: Int) {
            hid = null
            host = null
            registered = false
            main.post { publish(KeyboardState.Stopped) }
        }
    }

    private val callback = object : BluetoothHidDevice.Callback() {
        override fun onAppStatusChanged(pluggedDevice: BluetoothDevice?, isRegistered: Boolean) {
            val wasRegistered = registered
            registered = isRegistered
            main.post {
                main.removeCallbacks(registrationTimeout)
                when {
                    isRegistered -> {
                        publish(host?.let { KeyboardState.Connected(displayName(it)) } ?: KeyboardState.NotConnected)
                        if (host == null) reconnect(pluggedDevice)
                    }
                    wasRegistered -> publish(KeyboardState.Stopped)
                    else -> publish(KeyboardState.Unsupported)
                }
            }
        }

        override fun onConnectionStateChanged(device: BluetoothDevice, state: Int) {
            main.post {
                when (state) {
                    BluetoothProfile.STATE_CONNECTED -> {
                        host = device
                        prefs.edit().putString(KEY_LAST_HOST, device.address).apply()
                        publish(KeyboardState.Connected(displayName(device)))
                    }
                    BluetoothProfile.STATE_DISCONNECTED -> if (host == null || host == device) {
                        host = null
                        publish(if (registered) KeyboardState.NotConnected else KeyboardState.Stopped)
                    }
                }
            }
        }

        // The computer may ask for the current report (e.g. right after connecting): all keys up.
        override fun onGetReport(device: BluetoothDevice, type: Byte, id: Byte, bufferSize: Int) {
            hid?.replyReport(device, type, id, KeyMap.releaseReport())
        }

        // LED state (Caps Lock etc.) from the computer: acknowledged, not needed.
        override fun onSetReport(device: BluetoothDevice, type: Byte, id: Byte, data: ByteArray?) {
            hid?.reportError(device, BluetoothHidDevice.ERROR_RSP_SUCCESS)
        }
    }

    /**
     * After registering, reconnect to the computer the phone last typed into (e.g. after the
     * phone was locked or the app reopened), so the operator rarely has to press Connect.
     */
    private fun reconnect(plugged: BluetoothDevice?) {
        val proxy = hid ?: return
        val target = plugged ?: prefs.getString(KEY_LAST_HOST, null)?.let { address ->
            adapter?.bondedDevices?.firstOrNull { it.address == address }
        }
        if (target != null) proxy.connect(target)
    }

    private fun publish(newState: KeyboardState) {
        state = newState
        onState(newState)
    }

    private companion object {
        const val KEY_DELAY_MS = 20L
        const val REGISTRATION_TIMEOUT_MS = 8_000L
        const val KEY_LAST_HOST = "lastHost"
    }
}
