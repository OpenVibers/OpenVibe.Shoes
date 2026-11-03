'use strict';
// What Open.Shoes tells an agent about itself (openvibe-shared/agent-layer): /.well-known/agent.json (SEO-2).
// Every field is something this site really serves; the purpose is its own llms.txt summary.
module.exports = {
    id: "shoes",
    name: "Open.Shoes",
    purpose: "Every shoe, every market, the right price: one page per model with every store's all-in price, a price history from daily snapshots, the size-price curve and a watch for your size.",
    home: "https://open.shoes",
    site: "open.shoes",
    api: "/api/v1",
    docs: "/developers",
    openapi: '/openapi.json',
    policy: {
        auth: ["none", "Network OIDC"],
    },
};
