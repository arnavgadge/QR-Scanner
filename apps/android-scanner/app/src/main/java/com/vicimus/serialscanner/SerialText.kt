package com.vicimus.serialscanner

import java.util.Locale

/** Serials are only A-Z and 0-9 (e.g. 13WAA00101A26). */
object SerialText {
    /**
     * Upper-cases and drops every character that is not A-Z or 0-9: spaces, punctuation,
     * lower-case look-alikes after upper-casing, accents, Devanagari digits, line breaks.
     * Locale.ROOT so 'i' always becomes 'I' (not the Turkish dotted İ).
     */
    fun clean(raw: String): String =
        raw.uppercase(Locale.ROOT).filter { it in 'A'..'Z' || it in '0'..'9' }

    fun isValid(text: String): Boolean = text.isNotEmpty() && clean(text) == text
}
