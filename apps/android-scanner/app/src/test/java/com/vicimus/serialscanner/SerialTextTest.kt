package com.vicimus.serialscanner

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SerialTextTest {
    @Test
    fun keepsAValidSerial() {
        assertEquals("13WAA00101A26", SerialText.clean("13WAA00101A26"))
    }

    @Test
    fun upperCasesLetters() {
        assertEquals("13WAA00101A26", SerialText.clean("13waa00101a26"))
        assertEquals("I", SerialText.clean("i")) // never the Turkish dotted capital I
    }

    @Test
    fun stripsEverythingThatIsNotAToZOrZeroToNine() {
        assertEquals("13WAA00101A26", SerialText.clean(" 13 WAA-001.01/A26\n"))
        assertEquals("13WAA", SerialText.clean("13WAA१२३")) // Devanagari digits dropped
        assertEquals("AE", SerialText.clean("A_É:E")) // accented letter dropped
        assertEquals("", SerialText.clean("—\t ."))
    }

    @Test
    fun validity() {
        assertTrue(SerialText.isValid("13WAA00101A26"))
        assertFalse(SerialText.isValid(""))
        assertFalse(SerialText.isValid("13waa"))
        assertFalse(SerialText.isValid("13-WAA"))
    }
}
