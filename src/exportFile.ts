import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform, Share } from 'react-native';
import type { ExportFormat } from './exportData';

const MIME: Record<ExportFormat, string> = { json: 'application/json', csv: 'text/csv' };

/** Writes the file to Rin's own cache, clearing the last one, and opens the share sheet on it */
export async function shareExport(name: string, body: string, format: ExportFormat): Promise<void> {
  const dir = new Directory(Paths.cache, 'export');
  if (dir.exists) dir.delete();
  dir.create();
  const file = new File(dir, name);
  file.write(body);
  if (Platform.OS === 'ios') {
    await Share.share({ url: file.uri });
    return;
  }
  await Sharing.shareAsync(file.uri, { mimeType: MIME[format], dialogTitle: name });
}
