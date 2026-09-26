// Placeholder Firebase config for CI; the real files only exist on EAS.
const fs = require('fs');
const path = require('path');
const { expo } = require('../../app.json');

const dir = path.resolve(process.argv[2] || 'firebase-stub');
fs.mkdirSync(dir, { recursive: true });

const json = path.join(dir, 'google-services.json');
fs.writeFileSync(
  json,
  JSON.stringify({
    project_info: { project_number: '000000000000', project_id: 'ci-stub', storage_bucket: 'ci-stub.appspot.com' },
    client: [
      {
        client_info: {
          mobilesdk_app_id: '1:000000000000:android:0000000000000000',
          android_client_info: { package_name: expo.android.package },
        },
        oauth_client: [],
        api_key: [{ current_key: 'ci-stub' }],
        services: { appinvite_service: { other_platform_oauth_client: [] } },
      },
    ],
    configuration_version: '1',
  }),
);

const plist = path.join(dir, 'GoogleService-Info.plist');
const entries = {
  API_KEY: 'ci-stub',
  GCM_SENDER_ID: '000000000000',
  PLIST_VERSION: '1',
  BUNDLE_ID: expo.ios.bundleIdentifier,
  PROJECT_ID: 'ci-stub',
  STORAGE_BUCKET: 'ci-stub.appspot.com',
  GOOGLE_APP_ID: '1:000000000000:ios:0000000000000000',
};
fs.writeFileSync(
  plist,
  `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
${Object.entries(entries)
  .map(([k, v]) => `  <key>${k}</key>\n  <string>${v}</string>`)
  .join('\n')}
</dict>
</plist>
`,
);

const env = `GOOGLE_SERVICES_JSON=${json}\nGOOGLE_SERVICE_INFO_PLIST=${plist}\n`;
if (process.env.GITHUB_ENV) fs.appendFileSync(process.env.GITHUB_ENV, env);
process.stdout.write(env);
