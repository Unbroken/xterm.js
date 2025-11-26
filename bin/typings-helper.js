/**
 * Copyright (c) 2024 The xterm.js authors. All rights reserved.
 * @license MIT
 *
 * Cross-platform helper for managing typings files during npm pack.
 * Usage: node bin/typings-helper.js <prepack|postpack> <typings-file>
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const [, , mode, typingsFile] = process.argv;

if (!mode || !typingsFile) {
  console.error('Usage: node typings-helper.js <prepack|postpack> <typings-file>');
  process.exit(1);
}

const typingsDir = path.join(process.cwd(), 'typings');
const targetPath = path.join(typingsDir, typingsFile);
const sourcePath = path.join(process.cwd(), '..', 'typings', typingsFile);
const relativeSymlinkTarget = `../../typings/${typingsFile}`;

// Remove file or symlink if it exists
function removeIfExists(filePath) {
  try {
    fs.unlinkSync(filePath);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      throw err;
    }
  }
}

if (mode === 'prepack') {
  // Remove existing file/symlink and copy the actual file
  removeIfExists(targetPath);
  fs.copyFileSync(sourcePath, targetPath);
  console.log(`Copied ${sourcePath} to ${targetPath}`);
} else if (mode === 'postpack') {
  // Remove the copied file and restore the symlink via git checkout
  removeIfExists(targetPath);
  execSync(`git checkout -- "${typingsFile}"`, { cwd: typingsDir });
  console.log(`Restored symlink ${targetPath}`);
} else {
  console.error(`Unknown mode: ${mode}. Use 'prepack' or 'postpack'.`);
  process.exit(1);
}
