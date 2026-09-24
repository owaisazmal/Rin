/**
 * What sentences like "everything on this phone" call the device. The app
 * loads device.native.ts instead; this plain version is the one Jest runs.
 */
export function device(): string {
  return 'phone';
}
