#!/bin/bash

set -eo pipefail

npm ci
npm run setup
npm run package-headless
npm run package
node bin/package.js

