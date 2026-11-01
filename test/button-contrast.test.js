'use strict';
/**
 * WCAG 2.1 AA: white on the room accent read 2.5:1 on Vibe's salmon. The room kit gives every room a button pair,
 * --room-fill and --room-on, made for a filled button; the plain accent is still the fallback for a roomless page.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'shoes.css'), 'utf8');
assert.match(
    css,
    /\.sh-btn \{[^\n]*border: 1px solid var\(--room-fill, var\(--accent\)\);[^\n]*background: var\(--room-fill, var\(--accent\)\); color: var\(--room-on, #fff\);/,
    'the main button fills with --room-fill and writes --room-on on it'
);
assert.ok(!/\.sh-btn \{[^\n]*background: var\(--room-accent, var\(--accent\)\)/.test(css), 'white text is not put on the raw room accent');
console.log('button contrast: the room fill pair is used');
