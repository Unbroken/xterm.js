/**
 * Copyright (c) 2021 The xterm.js authors. All rights reserved.
 * @license MIT
 */

const { exec } = require('child_process');
const fs = require('fs');
const { join } = require('path');

const repoRoot = join(__dirname, '..');
const headlessRoot = join(repoRoot, 'headless');

console.log('> headless/package.json');
const xtermPackageJson = require('../package.json');
const xtermHeadlessPackageJson = {
  ...xtermPackageJson,
  name: '@xterm/headless',
  description: 'A headless terminal component that runs in Node.js',
  main: 'lib-headless/xterm-headless.js',
  types: 'typings/xterm-headless.d.ts',
  scripts: {
    "prepack": "node ../bin/typings-helper.js prepack xterm-headless.d.ts",
    "postpack": "node ../bin/typings-helper.js postpack xterm-headless.d.ts",
    "package": "true"
  },
};
delete xtermHeadlessPackageJson['devDependencies'];
delete xtermHeadlessPackageJson['style'];
fs.writeFileSync(join(headlessRoot, 'package.json'), JSON.stringify(xtermHeadlessPackageJson, null, 2));
console.log(fs.readFileSync(join(headlessRoot, 'package.json')).toString());

console.log('> headless/logo-full.png');
fs.copyFileSync(
  join(repoRoot, 'images/logo-full.png'),
  join(headlessRoot, 'logo-full.png')
);

function mkdirF(p) {
  if (!fs.existsSync(p)) {
    fs.mkdirSync(p);
  }
}

console.log('> Publish dry run');
exec('npm publish --dry-run', { cwd: headlessRoot }, (error, stdout, stderr) => {
  if (error) {
    console.log(`error: ${error.message}`);
    return;
  }
  if (stderr) {
    console.error(`stderr:\n${stderr}`);
  }
  console.log(`stdout:\n${stdout}`);
});
