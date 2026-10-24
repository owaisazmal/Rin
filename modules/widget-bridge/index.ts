import { requireOptionalNativeModule } from 'expo';

interface WidgetBridgeNativeModule {
  setSnapshot(json: string): void;
}

// optional: the native side only exists in a dev or release build
const WidgetBridge = requireOptionalNativeModule<WidgetBridgeNativeModule>('WidgetBridge');

/** Stores the snapshot where the widgets read it and asks them to redraw. */
export function setSnapshot(json: string): void {
  WidgetBridge?.setSnapshot(json);
}
