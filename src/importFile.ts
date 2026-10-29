import { File } from 'expo-file-system';
import { Platform } from 'react-native';

/** Far above any export Rin makes, so a bigger file is never read into memory */
const MAX_BYTES = 10_000_000;

/** The chosen file's name and text, null text for one too big to be an export, or null if closed */
export async function pickImport(): Promise<{ name: string; text: string | null } | null> {
  const picked = await File.pickFileAsync({
    // some Android file managers label .json oddly, so everything is offered there
    mimeTypes: Platform.OS === 'ios' ? ['application/json', 'text/plain'] : [],
  });
  if (picked.canceled) return null;
  const file = picked.result;
  try {
    if ((file.size ?? 0) > MAX_BYTES) return { name: file.name, text: null };
    return { name: file.name, text: await file.text() };
  } finally {
    // iOS hands Rin a copy, which is Rin's to remove; on Android it is the user's file
    if (Platform.OS === 'ios') {
      try {
        file.delete();
      } catch {
        // the system clears its temporary folder anyway
      }
    }
  }
}
