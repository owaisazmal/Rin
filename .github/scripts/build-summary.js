// Turns `eas build --json` output into a Markdown table of build links.
let builds;
try {
  builds = JSON.parse(require('fs').readFileSync(process.argv[2], 'utf8'));
} catch {}
if (!Array.isArray(builds) || !builds.length) {
  console.error('::error::eas build printed no builds; check expo.dev in case one started anyway.');
  process.exit(1);
}
const names = { IOS: 'iOS', ANDROID: 'Android' };
const lines = ['| Platform | Version | Build |', '| - | - | - |'];
for (const b of builds) {
  const url = `https://expo.dev/accounts/${b.app.ownerAccount.name}/projects/${b.app.slug}/builds/${b.id}`;
  lines.push(`| ${names[b.platform] ?? b.platform} | ${b.appVersion} (${b.appBuildVersion}) | [${b.status}](${url}) |`);
}
lines.push('', 'Builds run on EAS; the links show their progress.');
console.log(lines.join('\n'));
