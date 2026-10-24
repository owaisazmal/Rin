// Polls the builds in `eas build --json` output until they end; fails unless every one finished.
const fs = require('fs');
const { execFileSync } = require('child_process');

const names = { IOS: 'iOS', ANDROID: 'Android' };
const ended = ['FINISHED', 'ERRORED', 'CANCELED'];
const pollSeconds = Number(process.env.POLL_SECONDS) || 60;
// eas or the network failing this many polls in a row ends the wait
const maxMisses = 5;

const sleep = (s) => new Promise((resolve) => setTimeout(resolve, s * 1000));
// workflow commands end at a newline, so a multi-line message has to be escaped
const escape = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const summary = (line) => process.env.GITHUB_STEP_SUMMARY && fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${line}\n`);

function view(id) {
  const out = execFileSync(process.env.EAS_BIN || 'eas', ['build:view', id, '--json'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return JSON.parse(out);
}

async function main() {
  const started = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const last = new Map(started.map((b) => [b.id, b]));
  const pending = new Set(last.keys());
  let misses = 0;

  while (pending.size) {
    for (const id of pending) {
      let b;
      try {
        b = view(id);
        misses = 0;
      } catch (e) {
        if (++misses >= maxMisses) throw e;
        console.log(`::warning::Could not read build ${id} (${e.message.split('\n')[0]}); trying again.`);
        continue;
      }
      if (b.status !== last.get(id).status) console.log(`${names[b.platform] ?? b.platform}: ${b.status}`);
      last.set(id, b);
      if (ended.includes(b.status)) pending.delete(id);
    }
    if (pending.size) await sleep(pollSeconds);
  }

  let failed = false;
  summary('');
  for (const b of last.values()) {
    const name = `${names[b.platform] ?? b.platform} ${b.appVersion} (${b.appBuildVersion})`;
    const url = `https://expo.dev/accounts/${b.app.ownerAccount.name}/projects/${b.app.slug}/builds/${b.id}`;
    const minutes = Math.round((Date.parse(b.completedAt ?? b.updatedAt) - Date.parse(b.createdAt)) / 60000);
    if (b.status === 'FINISHED') {
      console.log(`${name} finished on EAS after ${minutes} min.`);
      summary(`${name} finished on EAS after ${minutes} min.`);
      continue;
    }
    failed = true;
    const what = b.status === 'CANCELED' ? 'was canceled' : 'failed';
    const reason = b.error?.message ?? 'EAS gave no reason.';
    console.log(`::error title=${name} ${what} on EAS::${escape(reason)}`);
    summary(`**${name} ${what} on EAS:** ${reason.replace(/\s+/g, ' ').trim()} The [build page](${url}) has the full logs.`);
  }
  if (failed) process.exit(1);
}

main().catch((e) => {
  console.log(`::error::${escape(e.message)}`);
  process.exit(1);
});
