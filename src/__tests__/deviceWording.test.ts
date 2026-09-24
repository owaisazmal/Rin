import type { BackupStatus } from '../hooks/autoBackupPolicy';
import { backupCard } from '../screens/backupWording';

// the app's device.native.ts answers "iPad" on an iPad; this file stands in for it
jest.mock('../device', () => ({ device: () => 'iPad' }));

const status: BackupStatus = { waiting: [], blocked: [], damaged: [], reconciled: true };

describe('backup wording on a tablet', () => {
  it('names the device it is on rather than calling it a phone', () => {
    const card = backupCard(status, null);

    expect(card.body).toBe('Everything on this iPad matches the backup.');
  });
});
