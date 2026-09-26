// Fails a release the stores would reject. Only EAS cloud builds are visible here.
const fs = require('fs');
const { execFileSync } = require('child_process');
const { expo } = require('../../app.json');

const platform = process.env.PLATFORM || 'all';
if (!['all', 'ios', 'android'].includes(platform)) {
  console.error(`::error::Unknown platform "${platform}"`);
  process.exit(1);
}
const platforms = platform === 'all' ? ['ios', 'android'] : [platform];
const errors = [];

if (process.env.GITHUB_REF_TYPE === 'tag' && process.env.GITHUB_REF_NAME !== `v${expo.version}`) {
  errors.push(`Tag ${process.env.GITHUB_REF_NAME} does not match app.json version ${expo.version}; expected v${expo.version}.`);
}

// iOS build numbers only have to rise within one version; Android's versionCode never repeats.
const checks = {
  ios: { field: 'ios.buildNumber', value: expo.ios.buildNumber, filter: ['--app-version', expo.version] },
  android: { field: 'android.versionCode', value: expo.android.versionCode, filter: [] },
};

function lastBuildNumber(p, filter) {
  const out = execFileSync(
    process.env.EAS_BIN || 'eas',
    ['build:list', '--platform', p, '--distribution', 'store', ...filter, '--limit', '50', '--json', '--non-interactive'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
  );
  const used = JSON.parse(out)
    .filter((b) => b.status !== 'ERRORED' && b.status !== 'CANCELED')
    .map((b) => Number(b.appBuildVersion))
    .filter(Number.isInteger);
  return used.length ? Math.max(...used) : 0;
}

for (const p of platforms) {
  const { field, value, filter } = checks[p];
  if (!/^\d+$/.test(String(value))) {
    errors.push(`${field} in app.json is "${value}"; expected a whole number.`);
    continue;
  }
  let last;
  try {
    last = lastBuildNumber(p, filter);
  } catch (e) {
    errors.push(`Could not list EAS builds for ${p}: ${e.message.split('\n')[0]}`);
    continue;
  }
  if (Number(value) > last) {
    console.log(`${p}: ${field} ${value} is above the last EAS cloud store build (${last || 'none'})`);
  } else {
    errors.push(`${field} is ${value} but EAS already has a store build numbered ${last}. Bump it in app.json, commit, and run the release again.`);
  }
}

for (const e of errors) console.error(`::error::${e}`);
if (errors.length) process.exit(1);
if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `platforms=${JSON.stringify(platforms)}\n`);
