// Fails unless eas.json builds with the Node version in .nvmrc.
const fs = require('fs');
const { build } = require('../../eas.json');

const want = fs.readFileSync(require.resolve('../../.nvmrc'), 'utf8').trim();
const errors = [];
if (!build.base?.node) errors.push(`build.base.node is not set; expected ${want}`);
for (const [name, profile] of Object.entries(build)) {
  if (profile.node && profile.node !== want) errors.push(`build.${name}.node is ${profile.node} but .nvmrc is ${want}`);
}
for (const e of errors) console.error(`::error file=eas.json::${e}`);
if (errors.length) process.exit(1);
console.log(`eas.json and .nvmrc both use Node ${want}`);
