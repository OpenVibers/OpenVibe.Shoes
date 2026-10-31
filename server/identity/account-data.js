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
        note: 'Models, offers, prices and drops are the network\'s public shoe record; only your watches are here.',
        log,
    });
}

module.exports = { create, TABLES, TOPICS };
