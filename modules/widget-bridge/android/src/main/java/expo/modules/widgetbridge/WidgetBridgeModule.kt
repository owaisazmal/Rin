package expo.modules.widgetbridge

import android.appwidget.AppWidgetManager
import android.content.Context
import android.content.Intent
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// Widgets live in the app's own package and read this SharedPreferences entry; same JSON as iOS.
const val PREFS_NAME = "widget_snapshot"
const val SNAPSHOT_KEY = "widgetSnapshot"

class WidgetBridgeModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("WidgetBridge")

    Function("setSnapshot") { json: String ->
      val context: Context = appContext.reactContext ?: return@Function
      context
        .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        .edit()
        .putString(SNAPSHOT_KEY, json)
        .apply()

      // broadcast rather than calling the widget classes: this library can't depend on the app
      runCatching {
        val manager = AppWidgetManager.getInstance(context)
        manager.installedProviders
          .filter { it.provider.packageName == context.packageName }
          .forEach { info ->
            val ids = manager.getAppWidgetIds(info.provider)
            if (ids.isNotEmpty()) {
              context.sendBroadcast(
                Intent(AppWidgetManager.ACTION_APPWIDGET_UPDATE).apply {
                  component = info.provider
                  putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids)
                }
              )
            }
          }
      }
    }
  }
}
