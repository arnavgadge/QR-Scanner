package com.vicimus.serialscanner

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.vicimus.serialscanner.hid.HidKeyboard
import com.vicimus.serialscanner.hid.KeyboardState

/**
 * STEP 1 (keyboard mode check): register as a Bluetooth keyboard, let the computer pair, and type
 * a fixed test serial into whatever is focused on the computer. The camera/OCR screen (step 2) is
 * added only once keyboard mode is confirmed on the target phone.
 */
class MainActivity : AppCompatActivity() {

    private var keyboard: HidKeyboard? = null
    private var askedToEnableBluetooth = false

    private lateinit var status: TextView
    private lateinit var unsupported: TextView
    private lateinit var pairButton: Button
    private lateinit var connectButton: Button
    private lateinit var testButton: Button

    /** Android 12+ asks at runtime; on 9-11 the Bluetooth permissions are granted at install. */
    private val runtimePermissions: Array<String> =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            arrayOf(Manifest.permission.BLUETOOTH_CONNECT, Manifest.permission.BLUETOOTH_ADVERTISE)
        } else {
            emptyArray()
        }

    private val permissionRequest =
        registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { granted ->
            if (granted.values.all { it }) startKeyboard() else showStatus(getString(R.string.status_no_permission))
        }

    private val enableBluetooth =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { startKeyboard() }

    private val makeDiscoverable =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        status = findViewById(R.id.status)
        unsupported = findViewById(R.id.unsupported)
        pairButton = findViewById(R.id.pairButton)
        connectButton = findViewById(R.id.connectButton)
        testButton = findViewById(R.id.testButton)

        pairButton.setOnClickListener { requestDiscoverable() }
        connectButton.setOnClickListener { chooseComputer() }
        testButton.setOnClickListener { typeTestSerial() }

        if (hasPermissions()) startKeyboard() else permissionRequest.launch(runtimePermissions)
    }

    override fun onDestroy() {
        keyboard?.stop()
        keyboard = null
        super.onDestroy()
    }

    private fun hasPermissions() = runtimePermissions.all {
        ContextCompat.checkSelfPermission(this, it) == PackageManager.PERMISSION_GRANTED
    }

    @SuppressLint("MissingPermission") // only reached with permissions granted
    private fun startKeyboard() {
        if (!hasPermissions()) return showStatus(getString(R.string.status_no_permission))
        keyboard?.stop()
        keyboard = HidKeyboard(this, ::render).also { it.start() }
    }

    @SuppressLint("MissingPermission") // only reached with permissions granted
    private fun render(state: KeyboardState) {
        val supported = state != KeyboardState.Unsupported
        unsupported.visibility = if (supported) View.GONE else View.VISIBLE
        pairButton.isEnabled = supported && state != KeyboardState.BluetoothOff
        connectButton.isEnabled = supported && state != KeyboardState.BluetoothOff
        testButton.isEnabled = state is KeyboardState.Connected
        showStatus(
            when (state) {
                KeyboardState.Starting -> getString(R.string.status_starting)
                KeyboardState.BluetoothOff -> getString(R.string.status_bluetooth_off)
                KeyboardState.Unsupported -> getString(R.string.unsupported)
                KeyboardState.NotConnected -> getString(R.string.status_not_connected)
                KeyboardState.Stopped -> getString(R.string.status_stopped)
                is KeyboardState.Connected -> getString(R.string.status_connected, state.computerName)
            },
        )
        // Ask once; if the operator declines, the status line says to turn Bluetooth on.
        if (state == KeyboardState.BluetoothOff && !askedToEnableBluetooth) {
            askedToEnableBluetooth = true
            enableBluetooth.launch(Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE))
        }
    }

    private fun showStatus(text: String) {
        status.text = text
    }

    /** Lets the computer find the phone for the first pairing (2 minutes). */
    @SuppressLint("MissingPermission")
    private fun requestDiscoverable() {
        makeDiscoverable.launch(
            Intent(BluetoothAdapter.ACTION_REQUEST_DISCOVERABLE)
                .putExtra(BluetoothAdapter.EXTRA_DISCOVERABLE_DURATION, 120),
        )
    }

    /** Connects to a computer that is already paired (e.g. after a PC reboot). */
    private fun chooseComputer() {
        val kb = keyboard ?: return
        val devices = kb.pairedDevices()
        if (devices.isEmpty()) {
            Toast.makeText(this, R.string.no_paired_computers, Toast.LENGTH_LONG).show()
            return
        }
        AlertDialog.Builder(this)
            .setTitle(R.string.connect)
            .setItems(devices.map { kb.displayName(it) }.toTypedArray()) { _, which ->
                kb.connect(devices[which])
            }
            .show()
    }

    private fun typeTestSerial() {
        val kb = keyboard ?: return
        testButton.isEnabled = false
        kb.type(TEST_SERIAL) { ok ->
            testButton.isEnabled = kb.isConnected
            if (!ok) Toast.makeText(this, R.string.type_failed, Toast.LENGTH_LONG).show()
        }
    }

    private companion object {
        const val TEST_SERIAL = "13WAA00101A26"
    }
}
