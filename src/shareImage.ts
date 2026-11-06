import { PixelRatio, Platform, Share } from 'react-native';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { captureRef } from 'react-native-view-shot';
import type { RefObject } from 'react';
import type { View } from 'react-native';

/** 4:5, the portrait size every feed accepts without cropping */
export const SHARE_IMAGE = { width: 1080, height: 1350 };

/** Renders the view to a PNG named `name` in Rin's own cache, clearing the last one, and opens the share sheet on it */
export async function shareViewAsImage(ref: RefObject<View | null>, name: string): Promise<void> {
  // iOS takes the size in points and draws at the screen's scale; Android takes pixels as they are
  const scale = Platform.OS === 'ios' ? PixelRatio.get() : 1;
  const captured = await captureRef(ref, {
    format: 'png',
    quality: 1,
    result: 'tmpfile',
    width: SHARE_IMAGE.width / scale,
    height: SHARE_IMAGE.height / scale,
  });
  // the capture lands under a random name, and the share sheet shows the file's name
  const dir = new Directory(Paths.cache, 'share');
  if (dir.exists) dir.delete();
  dir.create();
  const file = new File(dir, `${name}.png`);
  new File(captured).move(file);
  if (Platform.OS === 'ios') {
    await Share.share({ url: file.uri });
    return;
  }
  await Sharing.shareAsync(file.uri, { mimeType: 'image/png', dialogTitle: name });
}
