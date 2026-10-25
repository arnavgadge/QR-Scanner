package com.vicimus.serialscanner

import com.vicimus.serialscanner.hid.KeyMap
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class KeyMapTest {
    @Test
    fun capitalLettersAreShiftPlusLetterKey() {
        assertEquals(KeyMap.Key(KeyMap.MODIFIER_LEFT_SHIFT, 0x04), KeyMap.keyFor('A'))
        assertEquals(KeyMap.Key(KeyMap.MODIFIER_LEFT_SHIFT, 0x1A), KeyMap.keyFor('W'))
        assertEquals(KeyMap.Key(KeyMap.MODIFIER_LEFT_SHIFT, 0x1D), KeyMap.keyFor('Z'))
        for (c in 'A'..'Z') {
            assertEquals(c.toString(), 0x04 + (c - 'A'), KeyMap.keyFor(c)!!.usage)
        }
    }

    @Test
    fun digitsHaveNoModifier() {
        assertEquals(KeyMap.Key(KeyMap.MODIFIER_NONE, 0x1E), KeyMap.keyFor('1'))
        assertEquals(KeyMap.Key(KeyMap.MODIFIER_NONE, 0x26), KeyMap.keyFor('9'))
        assertEquals(KeyMap.Key(KeyMap.MODIFIER_NONE, 0x27), KeyMap.keyFor('0'))
    }

    @Test
    fun nothingElseIsTypeable_inParticularNeverEnter() {
        for (c in listOf('a', 'z', ' ', '\n', '\r', '-', '/', '.', 'É', '१')) {
            assertNull("'$c'", KeyMap.keyFor(c))
        }
        val enter = 0x28
        for (c in ('A'..'Z') + ('0'..'9')) {
            val key = KeyMap.keyFor(c)!!
            assert(key.usage != enter && key.usage in 0x04..0x27) { "$c -> ${key.usage}" }
        }
    }

    @Test
    fun reportsArePressReleasePairsInOrder() {
        val reports = KeyMap.reportsFor("1A")!!
        assertEquals(4, reports.size)
        assertArrayEquals(byteArrayOf(0, 0, 0x1E, 0, 0, 0, 0, 0), reports[0])
        assertArrayEquals(ByteArray(8), reports[1])
        assertArrayEquals(byteArrayOf(0x02, 0, 0x04, 0, 0, 0, 0, 0), reports[2])
        assertArrayEquals(ByteArray(8), reports[3])
    }

    @Test
    fun repeatedCharactersAreReleasedBetweenPresses() {
        val reports = KeyMap.reportsFor("00")!!
        assertArrayEquals(ByteArray(8), reports[1]) // otherwise the host sees one held key
        assertEquals(4, reports.size)
    }

    @Test
    fun theTestSerialIsFullyTypeable_andAnInvalidTextTypesNothing() {
        assertEquals(26, KeyMap.reportsFor("13WAA00101A26")!!.size)
        assertNull(KeyMap.reportsFor("13WAA-1")) // never sent partially
    }
}
