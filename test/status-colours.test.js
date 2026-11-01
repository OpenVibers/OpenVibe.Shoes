'use strict';
/**
 * Status words ("fresh", "stale", "−$20 from list") use the theme's readable status colours. --ok and --warn are
 * defined by no theme, so their pale green and amber fallbacks showed on light themes.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'shoes.css'), 'utf8');
assert.match(css, /\.sh-good \{ color: var\(--success-text,/);
assert.match(css, /\.sh-stale \{ color: var\(--warning-text,/);
assert.match(css, /\.sh-fresh \{ color: var\(--success-text,/);
assert.ok(!/var\(--(ok|warn)\b/.test(css), 'no colour names a variable no theme defines');
console.log('status colours: all checks passed');
