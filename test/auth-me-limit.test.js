'use strict';
// The navbar reads /auth/me on every page. Counted with sign-ins (60 in 15 minutes), a visitor who opened 60 pages
// looked signed out and the browser check saw 429s (11-15). /auth/me is not counted there; the sign-in routes still are.
const assert = require('assert');
const { boot, check, done } = require('./helpers/boot');

(async () => {
    const t = await boot();
    try {
        await check('70 session reads in a row all answer, none 429', async () => {
            const statuses = new Set();
            for (let i = 0; i < 70; i++) statuses.add((await t.get('/auth/me')).status);
            assert.ok(!statuses.has(429), `statuses ${[...statuses].join(',')}`);
        });
        await check('the sign-in routes are still limited', async () => {
            let limited = false;
            for (let i = 0; i < 70 && !limited; i++) limited = (await t.get('/auth/login')).status === 429;
            assert.ok(limited, 'the 61st sign-in start in 15 minutes is refused');
        });
    } finally {
        await done(t);
    }
})();
