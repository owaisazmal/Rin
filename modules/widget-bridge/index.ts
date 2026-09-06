import { requireOptionalNativeModule } from 'expo';

interface WidgetBridgeNativeModule {
  setSnapshot(json: string): void;
}

/**
 * Optional on purpose: the native side only exists in a dev/release build, so
 * requiring it strictly would crash anything running without it.
 */
const WidgetBridge = requireOptionalNativeModule<WidgetBridgeNativeModule>('WidgetBridge');

/** Writes the snapshot into the App Group and asks WidgetKit to redraw. */
export function setSnapshot(json: string): void {
  WidgetBridge?.setSnapshot(json);
}
