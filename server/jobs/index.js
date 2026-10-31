'use strict';

/**
 * The jobs, together: offers (OpenVibe.Deals), drops (official release pages) and eBay (official Browse API, only
 * with a key pair). Each refuses to start under SHOES_DRILL, where tests and a restore never touch a source.
 */
const { createOffersJob } = require('./offers');
const { createDropsJob } = require('./drops');
const { createEbayJob } = require('./ebay');

function createJobs({ config, catalogue, upstreams, log = console }) {
    const offers = createOffersJob({ config, catalogue, upstreams, log });
    const drops = createDropsJob({ config, catalogue, upstreams, log });
    const ebay = createEbayJob({ config, catalogue, upstreams, log });
    const all = [offers, drops, ebay];

    function start() {
        if (config.drill) return;
        for (const job of all) job.start();
    }

    function stop() {
        for (const job of all) job.stop();
    }

    return { offers, drops, ebay, all, start, stop };
}

module.exports = { createJobs };
