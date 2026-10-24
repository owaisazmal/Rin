import ExpoModulesCore
import WidgetKit

// must match the App Group in app.json and targets/widgets/expo-target.config.js
let appGroupIdentifier = "group.com.owaiskhan.monthlyplanning"
let snapshotKey = "widgetSnapshot"

public class WidgetBridgeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("WidgetBridge")

    Function("setSnapshot") { (json: String) -> Void in
      guard let defaults = UserDefaults(suiteName: appGroupIdentifier) else { return }
      defaults.set(json, forKey: snapshotKey)
      WidgetCenter.shared.reloadAllTimelines()
    }
  }
}
