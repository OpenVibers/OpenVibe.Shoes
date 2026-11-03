'use strict';
// Every icon in the bar's links is one the shared navbar draws (11-02: Home asked for fa-shoe-prints, which the
// OpenVibe glyph set does not have and Font Awesome is not loaded, so Home showed no icon at all), and the site is
// named for its domain, Open.Shoes.
//   node test/nav-icons.test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const layout = require('../server/render/layout');

const navbar = fs.readFileSync(path.join(__dirname, '..', 'node_modules', 'openvibe-shared', 'navbar.js'), 'utf8');
// The icons the navbar ships (NAV_ICONS) and the ones it loads beside itself (NAV_ICONS_LAZY).
const known = new Set([...navbar.matchAll(/'(fa-[a-z0-9-]+)'\s*:\s*\[/g)].map((m) => m[1]));
for (const m of navbar.matchAll(/NAV_ICONS_LAZY = \{([\s\S]*?)\};/g)) for (const n of m[1].match(/fa-[a-z0-9-]+/g) || []) known.add(n);
assert.ok(known.size > 20, 'the navbar\'s icon list was read');
const icons = [].concat(...[layout.NAV].flat(3).map((l) => (l && l.icon ? [l.icon] : [])));
assert.ok(icons.length >= 3, 'the bar has its links');
const missing = icons.filter((i) => !known.has(i));
assert.deepStrictEqual(missing, [], `icons the navbar cannot draw: ${missing.join(', ')}`);
assert.strictEqual(layout.NAV.find((l) => l.label === 'Home').icon, 'fa-house');
assert.strictEqual(layout.SITE_NAME, 'Open.Shoes', 'named for its domain');
console.log(`nav icons: ${icons.length} links, all drawn`);
