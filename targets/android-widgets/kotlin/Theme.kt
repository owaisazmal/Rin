package com.owaiskhan.monthlyplanning.widgets

import android.content.Context
import android.content.res.Configuration
import androidx.compose.ui.graphics.Color
import androidx.glance.unit.ColorProvider

// Mirrors src/theme.ts; Ints because the charts draw with android.graphics.Paint.
data class WidgetTheme(
  val bg: Int,
  val ink: Int,
  val inkSoft: Int,
  val accent: Int,
  val cellEmpty: Int,
  val done: Int,
  val missed: Int,
  val onState: Int,
  val ghLevels: List<Int>,
) {
  fun provider(value: Int) = ColorProvider(Color(value))

  fun stateColor(state: Int): Int = when (state) {
    1 -> done
    2 -> missed
    else -> cellEmpty
  }

  companion object {
    val dark = WidgetTheme(
      bg = 0xFF0D0D0D.toInt(),
      ink = 0xFFFFFFE3.toInt(),
      inkSoft = 0xFFCBCBCB.toInt(),
      accent = 0xFF8FA5BA.toInt(),
      cellEmpty = 0xFF1A1A1A.toInt(),
      done = 0xFF93C63F.toInt(),
      missed = 0xFFEF4C63.toInt(),
      onState = 0xFF0D0D0D.toInt(),
      // first two lifted to clear the card, as in src/theme.ts
      ghLevels = listOf(
        0xFF2A2A2A.toInt(), 0xFF386021.toInt(), 0xFF497B2D.toInt(),
        0xFF6DA939.toInt(), 0xFF93C63F.toInt(),
      ),
    )

    val light = WidgetTheme(
      bg = 0xFFFFFFE3.toInt(),
      ink = 0xFF4A4A4A.toInt(),
      inkSoft = 0xFF5F6B78.toInt(),
      accent = 0xFF57697C.toInt(),
      cellEmpty = 0xFFE5E5D5.toInt(),
      done = 0xFF7FB32E.toInt(),
      missed = 0xFFE5405A.toInt(),
      onState = 0xFF2E2E2E.toInt(),
      ghLevels = listOf(
        0xFFE5E5D5.toInt(), 0xFFD9ECB2.toInt(), 0xFFB7DC7A.toInt(),
        0xFF9CCD4D.toInt(), 0xFF7FB32E.toInt(),
      ),
    )

    /** Follows the app's appearance setting; the system one is only the fallback. */
    fun of(context: Context, snapshot: PlannerSnapshot?): WidgetTheme = when (snapshot?.theme) {
      "dark" -> dark
      "light" -> light
      else -> {
        val night = context.resources.configuration.uiMode and
          Configuration.UI_MODE_NIGHT_MASK == Configuration.UI_MODE_NIGHT_YES
        if (night) dark else light
      }
    }
  }
}
