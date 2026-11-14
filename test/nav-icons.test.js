'use strict';
// Every icon in the bar's links is an OpenVibe glyph (11-02: Home asked for a Font Awesome name the glyph set did not
// have, and Font Awesome is not loaded, so Home showed no icon at all), and the site is named for its domain, Open.Shoes.
//   node test/nav-icons.test.js
const assert = require('assert');
const glyphs = require('openvibe-shared/glyphs');
const layout = require('../server/render/layout');

assert.ok(glyphs.NAMES.length > 20, 'the glyph set was read');
const icons = [].concat(...[layout.NAV].flat(3).map((l) => (l && l.icon ? [l.icon] : [])));
assert.ok(icons.length >= 3, 'the bar has its links');
const missing = icons.filter((i) => !glyphs.NAMES.includes(i));
assert.deepStrictEqual(missing, [], `glyphs the navbar cannot draw: ${missing.join(', ')}`);
assert.strictEqual(layout.NAV.find((l) => l.label === 'Home').icon, 'home');
assert.strictEqual(layout.SITE_NAME, 'Open.Shoes', 'named for its domain');
console.log(`nav icons: ${icons.length} links, all drawn`);
