'use strict';

/**
 * Account export and deletion → Shoes (ADR-033; openvibe-sdk/account-data). The only rows a person owns here are
 * their watches. A model, an offer, a snapshot, a drop or a cited fact is the network's public record, not a
 * person's, so it is not exported or erased with an account; a watch is deleted outright.
 *
 * The database stores bare usr_ ids in the subject column. A watch is a threshold, a size and a public URL; it is
 * never a secret.
 */
const { createAccountData, TOPICS } = require('openvibe-sdk/account-data');

const TABLES = [
    { table: 'shoe_watches', subject: 'subject', value: (usr) => usr, file: 'watches.json', erase: 'delete' },
];

function create({ db, log = console } = {}) {
    return createAccountData({
        db,
        service: 'shoes',
        tables: TABLES,
        /**
         * A share row names its owner and its members by canonical subject, which a table map cannot cover: a watch's
         * own row goes, and so must its share row and everyone it named, or a deleted account would linger in somebody
         * else's member list. Children first: members, transfers and requests point at shares.
         */
        extraErase: async (t, subjects) => {
            for (const subject of subjects) {
                const id = String(subject).replace(/^user:/, '');
                await t.exec('DELETE FROM shoes_share_defaults WHERE subject = $1', [id]);
                await t.exec("DELETE FROM share_members WHERE service='shoes' AND subject->>'id' = $1", [id]);
                await t.exec("DELETE FROM share_transfers WHERE service='shoes' AND (from_subject->>'id' = $1 OR to_subject->>'id' = $1)", [id]);
                await t.exec("DELETE FROM share_access_requests WHERE service='shoes' AND subject->>'id' = $1", [id]);
            }
            for (const subject of subjects) {
                const id = String(subject).replace(/^user:/, '');
                const owned = await t.many("SELECT kind, resource_id FROM shares WHERE service='shoes' AND owner_subject->>'id' = $1", [id]);
                for (const row of owned) {
                    await t.exec("DELETE FROM share_members WHERE service='shoes' AND kind=$1 AND resource_id=$2", [row.kind, row.resource_id]);
                    await t.exec("DELETE FROM share_transfers WHERE service='shoes' AND kind=$1 AND resource_id=$2", [row.kind, row.resource_id]);
                    await t.exec("DELETE FROM share_access_requests WHERE service='shoes' AND kind=$1 AND resource_id=$2", [row.kind, row.resource_id]);
                    await t.exec("DELETE FROM shares WHERE service='shoes' AND kind=$1 AND resource_id=$2", [row.kind, row.resource_id]);
                }
            }
        },
        note: 'Models, offers, prices and drops are the network\'s public shoe record; only your watches are here.',
        log,
    });
}

module.exports = { create, TABLES, TOPICS };
