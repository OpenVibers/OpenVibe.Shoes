'use strict';
// openvibe-sdk/site (0.174.0) is the one implementation every site shares (the consolidation of 2026-11-16).
// The Network's signing key; this file stays for one release so nothing that requires it changes.
// A hand merge: this copy was the SDK's code with "[Open.Shoes]" in its log lines, so the swap did not match it.
const site = require('openvibe-sdk/site');

module.exports = { createKeyStore: (o = {}) => site.createKeyStore({ name: 'Open.Shoes', ...o }), jwksUrl: site.jwksUrl };
