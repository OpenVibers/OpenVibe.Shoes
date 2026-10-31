'use strict';

/**
 * The drops job: a brand's or a store's own public release page (and any RSS feeds a host configures) is read for
 * releases it publishes, and each one is written with the page it came from and the time it was read. No date is
 * invented; a release without a date is not imported. Raffle entries are never automated.
 *
 * Off under SHOES_DRILL; tests and scripts call runOnce().
 */
function createDropsJob({ config, catalogue, upstreams, log = console }) {
    let timer = null;
    let running = false;

    async function runOnce() {
        const runId = await catalogue.startJobRun({
            job: 'drops',
            sourceName: config.sources.dropsSourceName,
            sourceUrl: config.sources.dropsUrl,
        });
        const counts = { sources: 0, releases: 0, drops: 0, skipped: 0 };
        try {
            const sources = [{ url: config.sources.dropsUrl, name: config.sources.dropsSourceName, type: 'launch' }]
                .concat(config.sources.dropFeeds.map((f) => ({ url: f.url, name: f.name || f.url, type: f.type === 'rss' ? 'rss' : 'launch' })));
            for (const source of sources) {
                let releases = [];
                try {
                    releases = await upstreams.releaseCalendar(source);
                } catch (err) {
                    log.warn(`[OpenVibe.Shoes] drops source ${source.url} failed: ${err.message}`);
                    continue;
                }
                counts.sources++;
                counts.releases += releases.length;
                for (const release of releases) {
                    const row = await catalogue.upsertDrop(release);
                    if (row) counts.drops++;
                    else counts.skipped++;
                }
            }
            await catalogue.finishJobRun(runId, { ok: true, counts });
            log.log(`[OpenVibe.Shoes] drops: ${counts.drops} releases from ${counts.sources} source(s)`);
            return counts;
        } catch (err) {
            await catalogue.finishJobRun(runId, { ok: false, counts, error: err.message });
            throw err;
        }
    }

    function start() {
        if (config.drill || timer) return;
        const tick = () => {
            if (running) return;
            running = true;
            runOnce().catch((err) => log.warn('[OpenVibe.Shoes] drops job failed:', err.message)).finally(() => { running = false; });
        };
        timer = setInterval(tick, config.jobs.dropsIntervalMs);
        timer.unref();
        setTimeout(tick, 12_000).unref();
    }

    function stop() {
        if (timer) clearInterval(timer);
        timer = null;
    }

    return { name: 'drops', runOnce, start, stop };
}

module.exports = { createDropsJob };
