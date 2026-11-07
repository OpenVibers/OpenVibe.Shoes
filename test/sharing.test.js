'use strict';
/**
 * Sharing a watch (design 2026-11-06, visibility step 6): the one Share sheet (openvibe-sdk/share) and the one
 * check, canView, on the watch page and its API.
 *
 *   - a new watch is Only me; the list carries the Share button for its owner;
 *   - Anyone with the link reads the page and the API, and only its owner sees the list;
 *   - Specific people shows the gate, never what the watch looks for, to somebody not on the list;
 *   - the person's default for new watches, and "apply to all", work;
 *   - a watch is never on a gathered page: not the sitemap, not llms.txt.
 */
const assert = require('assert');
const { boot, check, done } = require('./helpers/boot');
const sharing = require('../server/sharing');
const { createCatalogue } = require('../server/catalogue');
const views = require('../server/views');
const { createApi } = require('../server/http/api');
const { createPageRoutes } = require('../server/http/pages');
const accountData = require('../server/identity/account-data');

(async () => {
    const t = await boot();
    try {
        await check('the sharing wiring loads: watches are never Everyone', async () => {
            assert.strictEqual(sharing.SERVICE, 'shoes');
            assert.strictEqual(sharing.KIND, 'watch');
            assert.deepStrictEqual(sharing.OFFERED, ['private', 'link', 'people']);
            assert.strictEqual(sharing.shareViewer({ kind: 'anonymous' }), null);
            assert.deepStrictEqual(sharing.shareViewer({ kind: 'user', subject: 'usr_x' }), { subject: { type: 'user', id: 'usr_x' }, staff: false });
            assert.strictEqual(typeof createCatalogue, 'function');
            assert.strictEqual(typeof createApi, 'function');
            assert.strictEqual(typeof views.watchPage, 'function');
            assert.strictEqual(typeof createPageRoutes, 'function');
            assert.strictEqual(typeof accountData.create, 'function');
        });
        const kim = t.network.addUser('kim');
        const bo = t.network.addUser('bo');
        const cy = t.network.addUser('cy');

        const call = (p, o = {}) => {
            const { headers, ...rest } = o;
            return t.get(p, { ...rest, headers: { 'x-requested-with': 'ov-share', ...(headers || {}) } });
        };
        const share = (id, o = {}) => call(`/api/v1/watch/${encodeURIComponent(id)}/share`, o);
        const setShare = async (id, body, as) => {
            const first = await share(id, { as });
            assert.strictEqual(first.status, 200, first.text);
            const etag = first.headers.get('etag');
            assert.ok(etag);
            return await share(id, { as, method: 'PUT', json: body, headers: { 'if-match': etag } });
        };
        const audienceRow = async (id) => await t.ctx.s.db.maybe(
            'SELECT audience FROM shares WHERE service = $1 AND kind = $2 AND resource_id = $3', ['shoes', 'watch', id]);
        const newWatch = async (subject, note = 'a listing') => (await t.ctx.catalogue.createWatch({ subject, kind: 'link', sourceUrl: 'https://www.ebay.com/itm/1', status: 'active', note })).id;

        let id;
        await check('a new watch is Only me, and the list carries the Share button for its owner', async () => {
            id = await newWatch(kim.subject);
            assert.deepStrictEqual(await audienceRow(id), { audience: 'private' });
            const mine = await t.get('/watches', { as: kim });
            assert.strictEqual(mine.status, 200, mine.text);
            assert.ok(mine.text.includes('data-ov-share-sheet') && mine.text.includes('data-kind="watch"'));
            assert.ok(mine.text.includes('ov-share.js'));
            assert.ok(mine.text.includes('Who can open a new watch'));
            const own = await t.get(`/watches/${id}`, { as: kim });
            assert.strictEqual(own.status, 200, own.text);
            assert.ok(own.text.includes('https://www.ebay.com/itm/1'));
            const other = await t.get(`/watches/${id}`, { as: bo });
            assert.strictEqual(other.status, 404);
            assert.ok(!other.text.includes('https://www.ebay.com/itm/1'), 'the watch is never shown to somebody else');
            assert.strictEqual((await t.get(`/watches/${id}`)).status, 404);
            assert.strictEqual((await t.get(`/api/v1/watches/${id}`)).status, 404);
        });

        await check('Anyone with the link reads the page and the API, and the list stays the owner\'s', async () => {
            const saved = await setShare(id, { audience: 'link' }, kim);
            assert.strictEqual(saved.status, 200, saved.text);
            assert.strictEqual(saved.json().audience, 'link');
            const guest = await t.get(`/watches/${id}`);
            assert.strictEqual(guest.status, 200, guest.text);
            assert.ok(guest.text.includes('https://www.ebay.com/itm/1'));
            assert.ok(guest.text.includes('Anyone with the link'));
            assert.ok(!guest.text.includes('data-ov-share-sheet'), 'a reader gets no Share sheet');
            const api = await t.get(`/api/v1/watches/${id}`);
            assert.strictEqual(api.status, 200);
            assert.strictEqual(api.json().watch.id, id);
            assert.strictEqual((await t.get('/api/v1/me/watches', { as: bo })).json().watches.length, 0);
        });

        await check('Specific people: a viewer reads, a stranger gets the gate', async () => {
            const saved = await setShare(id, { audience: 'people', members: [{ name: 'bo', role: 'viewer' }] }, kim);
            assert.strictEqual(saved.status, 200, saved.text);
            const viewer = await t.get(`/watches/${id}`, { as: bo });
            assert.strictEqual(viewer.status, 200, viewer.text);
            assert.ok(viewer.text.includes('Specific people'));
            const stranger = t.network.addUser('di');
            const gate = await t.get(`/watches/${id}`, { as: stranger });
            assert.strictEqual(gate.status, 404);
            assert.ok(gate.text.includes('shared with specific people'));
            assert.ok(!gate.text.includes('https://www.ebay.com/itm/1'), 'the gate never shows what the watch looks for');
            assert.ok(gate.text.includes('data-ov-share-gate'));
            assert.strictEqual((await t.get(`/api/v1/watches/${id}`, { as: stranger })).status, 404);
        });

        await check('the default applies to the next watch, and "apply to all" moves the existing one', async () => {
            const saved = await t.get('/watches/defaults', { as: kim, form: { audience: 'link', apply_all: '1' } });
            assert.strictEqual(saved.status, 302, saved.text);
            assert.deepStrictEqual(await audienceRow(id), { audience: 'link' });
            const next = await newWatch(kim.subject, 'another');
            assert.deepStrictEqual(await audienceRow(next), { audience: 'link' });
            const list = await t.get('/watches', { as: kim });
            assert.ok(list.text.includes('Who can open a new watch'), 'the default is on the product page');
            assert.strictEqual((await t.get(`/watches/${next}`)).status, 200, 'the next watch follows the default');
        });

        await check('a watch is never on a gathered page: not the sitemap, not llms.txt', async () => {
            assert.ok(!(await t.get('/sitemap.xml')).text.includes(id));
            assert.ok(!(await t.get('/llms.txt')).text.includes(id));
        });

        done();
    } finally {
        await t.close();
    }
})().catch((err) => { console.error(err); process.exit(1); });
