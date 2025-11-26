/**
 * Copyright (c) 2019 The xterm.js authors. All rights reserved.
 * @license MIT
 */

const cp = require('child_process');
const fs = require('fs');
const path = require('path');

const isDryRun = process.argv.includes('--dry');

log('Configuration:', 'green');
if (isDryRun) {
  log('  Dry run');
}

// Create output directory
const outputDir = path.resolve(__dirname, '../packages');
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}
log(`Output directory: ${outputDir}`, 'green');

// Package directories
const packageDirs = [
  path.resolve(__dirname, '..'),
  path.resolve(__dirname, '../headless'),
  path.resolve(__dirname, '../addons/addon-attach'),
  path.resolve(__dirname, '../addons/addon-clipboard'),
  path.resolve(__dirname, '../addons/addon-fit'),
  path.resolve(__dirname, '../addons/addon-image'),
  path.resolve(__dirname, '../addons/addon-ligatures'),
  path.resolve(__dirname, '../addons/addon-progress'),
  path.resolve(__dirname, '../addons/addon-search'),
  path.resolve(__dirname, '../addons/addon-serialize'),
  path.resolve(__dirname, '../addons/addon-unicode11'),
  path.resolve(__dirname, '../addons/addon-web-links'),
  path.resolve(__dirname, '../addons/addon-webgl')
];

// Pack all packages
for (const packageDir of packageDirs) {
  packPackage(packageDir);
}

log('Done!', 'green');

function packPackage(packageDir) {
  const packageJson = require(path.join(packageDir, 'package.json'));
  const packageName = packageJson.name;

  log(`Packing ${packageName}...`, 'green');

  // Get stable filename (without version)
  // @xterm/xterm -> xterm-xterm.tgz
  // @xterm/addon-fit -> xterm-addon-fit.tgz
  const stableFilename = packageName.replace('@', '').replace('/', '-') + '.tgz';
  const destPath = path.join(outputDir, stableFilename);

  if (isDryRun) {
    log(`  Would create: ${destPath}`);
    return;
  }

  // Run npm package
  let result = cp.spawnSync('npm', ['run', 'package'], {
    cwd: packageDir,
    encoding: 'utf-8',
    shell: true
  });

  if (result.status !== 0) {
    throw new Error(`npm run package failed for ${packageDir}: ${result.stderr}`);
  }

  // Run npm pack
  result = cp.spawnSync('npm', ['pack'], {
    cwd: packageDir,
    encoding: 'utf-8',
    shell: true
  });

  if (result.status !== 0) {
    throw new Error(`npm pack failed for ${packageName}: ${result.stderr}`);
  }

  // npm pack outputs the filename on the last line of stdout
  // (other lines may contain prepare script output)
  const lines = result.stdout.trim().split('\n').filter(line => line.length > 0);
  const packedFilename = lines[lines.length - 1];
  const packedPath = path.join(packageDir, packedFilename);

  // Move to output directory with stable name
  fs.renameSync(packedPath, destPath);
  log(`  Created: ${destPath}`);
}

/**
 * @param {string} message
 */
function log(message, color) {
  let colorSequence = '';
  switch (color) {
    case 'green': {
      colorSequence = '\x1b[32m';
      break;
    }
  }
  console.info([
    `[\x1b[2m${new Date().toLocaleTimeString('en-GB')}\x1b[0m] `,
    colorSequence,
    message,
    '\x1b[0m',
  ].join(''));
}
