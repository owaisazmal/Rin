// `npm run bump [-- 1.2.0]`: next iOS build number and Android versionCode, and optionally a new version.
const fs = require('fs');

const file = require.resolve('../../app.json');
const app = JSON.parse(fs.readFileSync(file, 'utf8'));
const { expo } = app;
const version = process.argv[2];

if (version !== undefined && !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`Version "${version}" should look like 1.2.0`);
  process.exit(1);
}
for (const [field, value] of [['ios.buildNumber', expo.ios.buildNumber], ['android.versionCode', expo.android.versionCode]]) {
  if (!/^\d+$/.test(String(value))) {
    console.error(`${field} in app.json is "${value}"; expected a whole number`);
    process.exit(1);
  }
}

const before = { version: expo.version, ios: expo.ios.buildNumber, android: expo.android.versionCode };
if (version) expo.version = version;
expo.ios.buildNumber = String(Number(expo.ios.buildNumber) + 1);
expo.android.versionCode = Number(expo.android.versionCode) + 1;
fs.writeFileSync(file, JSON.stringify(app, null, 2) + '\n');

if (version) console.log(`version ${before.version} -> ${expo.version}`);
console.log(`ios.buildNumber ${before.ios} -> ${expo.ios.buildNumber}`);
console.log(`android.versionCode ${before.android} -> ${expo.android.versionCode}`);
