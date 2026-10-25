package com.vicimus.serialscanner.hid

/**
 * Characters -> USB HID keyboard usages (HID Usage Tables, Keyboard/Keypad page 0x07).
 * Only A-Z and 0-9 can be typed; nothing else (in particular never Enter) has a mapping.
 * Usages are physical key positions: the computer turns them into characters using ITS keyboard
 * layout, which must be a QWERTY/US-compatible layout for letters and digits to come out right.
 */
object KeyMap {
    const val MODIFIER_NONE = 0x00
    const val MODIFIER_LEFT_SHIFT = 0x02

    /** Report ID used in [HidDescriptor.KEYBOARD]. */
    const val REPORT_ID = 1

    data class Key(val modifier: Int, val usage: Int)

    fun keyFor(c: Char): Key? = when (c) {
        in 'A'..'Z' -> Key(MODIFIER_LEFT_SHIFT, 0x04 + (c - 'A')) // Shift + a..z
        in '1'..'9' -> Key(MODIFIER_NONE, 0x1E + (c - '1'))
        '0' -> Key(MODIFIER_NONE, 0x27)
        else -> null
    }

    /** 8-byte boot-keyboard input report: modifiers, reserved, up to six keys (we press one). */
    fun pressReport(key: Key): ByteArray =
        byteArrayOf(key.modifier.toByte(), 0, key.usage.toByte(), 0, 0, 0, 0, 0)

    /** All keys up. */
    fun releaseReport(): ByteArray = ByteArray(8)

    /**
     * Press/release report pairs for [text], in order. Returns null (types nothing) if any
     * character cannot be typed, so a serial is never sent partially.
     */
    fun reportsFor(text: String): List<ByteArray>? {
        val keys = text.map { keyFor(it) ?: return null }
        return keys.flatMap { listOf(pressReport(it), releaseReport()) }
    }
}
