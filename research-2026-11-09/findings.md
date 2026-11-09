# Open.Shoes expansion research

Research date: 2026-11-09. Public pages were reviewed without accounts. Competitor features below describe the product’s public positioning, not a full usability audit.

## Market and competitor map

| Segment | Examples | What they are strong at | Product opportunity for Open.Shoes |
|---|---|---|---|
| General shoe retail | [Zappos](https://www.zappos.com/), [Foot Locker](https://www.footlocker.com/) | Broad retail inventory, brand and size navigation, straightforward purchase availability | Aggregate all-in prices and size stock across sources, with a model history and source timestamps |
| Sneaker resale | [StockX](https://stockx.com/), [GOAT](https://www.goat.com/) | Authentication/resale context and model/colourway discovery | Show new retail alongside resale only when source and condition are explicit; avoid implying authentication |
| Deal discovery | [Sole Retriever](https://www.soleretriever.com/), [Kicks Deals](https://www.kicksdeals.com/) | Release/deal discovery and sneaker-focused editorial | Combine official release links with price alerts and unambiguous all-in offer rows |
| Running research and specialty retail | [RunRepeat](https://runrepeat.com/), [Running Warehouse](https://www.runningwarehouse.com/), [Running Shoe Deals methodology](https://bestrunningshoedeals.com/methodology) | RunRepeat emphasizes testing/reviews; Running Warehouse has specialist product information; comparison sites show the value of exact model matching and size-aware price comparison | Add cited fit/spec facts and model-level size-price history; do not claim fit advice without a cited source |
| Kids | [Stride Rite sizing help](https://www.striderite.com/pages/sizing-help), [See Kai Run](https://seekairun.com/), [Pediped](https://pediped.com/), [Nike Kids](https://www.nike.com/w/kids-shoes-v4dhzy7ok), [Adidas Kids](https://www.adidas.com/us/kids-shoes) | Brand charts, printable measuring resources, stage/age-oriented navigation; Stride Rite explicitly says age is not a reliable shoe-size proxy beyond babies | Keep manufacturer-specific foot-length charts, label age as broad guidance, provide a print-and-measure page and opt-in check-in reminders |
| Socks | [Bombas](https://bombas.com/), [Darn Tough](https://darntough.com/), [Stance](https://www.stance.com/), [Balega](https://balega.com/) | Brand-specific sizing and clear use/material positioning (running, hiking, everyday, compression) | Cross-brand size lookup from shoe size with each brand chart cited; filter by use and material |
| Laces | [Lace Lab](https://www.lacelab.com/), [Kiwi](https://www.kiwishoecare.com/), [Ian’s Shoelace Site](https://www.fieggen.com/shoelace/) | Lace styles/lengths and practical lacing instructions | Eyelet-pair + method calculator; link the right length/type to each shoe only when known |
| Shoe care | [Jason Markk](https://jasonmarkk.com/), [Crep Protect](https://crepprotect.com/), [Reshoevn8r](https://reshoevn8r.com/) | Material-oriented cleaning kits and product education | Material guide (leather, suede, knit, canvas, mesh, nubuck) with product compatibility and citations |

The category expansion is commercially coherent: shoes bring intent, while socks, laces, care and insoles are adjacent replenishment or maintenance needs. Kids adds a distinct fit/measurement use case and recurring size checks. Treat revenue/market size as unquantified here; this pass is a competitor and source map, not a financial forecast.

## Source and access assessment

| Source | Access | Suitable use | Gate / caveat |
|---|---|---|---|
| OpenVibe.Deals | Existing public network feed; no key | Initial offers across supported product kinds | Confirm Deals’ current footwear/accessory classification and terms before expanding ingestion |
| eBay Browse API | Official API, existing Shoes client | Search/offer summaries for items | Owner must provision developer key pair; existing code already gates this source |
| Brand/store public Shopify storefront catalog (`/products.json`) | Sometimes public without auth | Product metadata and variants for participating DTC brands | Per-store permission/terms and request limits need review; public reachability is not blanket reuse permission; no price ingestion until terms are checked |
| Manufacturer size/care charts | Public pages/PDFs | Cited shoe/sock size conversion, kids foot-length tables, care compatibility | Preserve chart owner, URL, access date, units, region and model applicability; never infer one brand’s sizing from another |
| Open product-data datasets | No broadly established apparel equivalent confirmed in this search | Potential identifiers/material metadata | Candidate source only; licensing and coverage require separate review |
| Marketplace feeds and retailer affiliate APIs | Account/key-dependent | Wider retail coverage | Owner gate: no account creation or spend; do not enable until owner supplies credentials and approves terms |

Do not scrape Facebook Marketplace, automate raffles/draws, add affiliate links, or treat public HTML/catalog endpoints as permission by themselves. Missing credentials should continue to disable only that source with a plain status note.

## Modular product/API proposal

Use one typed product record for `shoe|laces|socks|care|insoles|kids`, with stable id, kind, brand, line/model, title, URL, image, variant/size fields, material/use tags, cited facts, source identity and check time. Offers should retain the network’s shared offer shape and source provenance. A product without a verified attribute should return null/unknown and render “not known yet.”

Proposed public endpoints from the brief: `GET /api/v1/products?kind=&q=&size=`, `GET /api/v1/products/:id/offers`, `GET /api/v1/tools/lace-length`, and `GET /api/v1/sizes/convert`. Keep the existing `/shoes` routes stable while this schema is introduced. Put `shoes.product@1` in Contracts and `ov.shoes.*` in SDK as separate library PRs; add the reusable `offerCard()` to Shared only if no compatible shared card exists. Deals can then consume Shoes’ public product search without sharing Shoes-specific persistence.

The kid-size reminder should store only a nickname and current size, require explicit opt-in, and schedule 3-month toddler / 6-month child check-ins through Today. Do not collect date of birth. Brand growth charts are guidance, not a guarantee that age predicts size.

## Evidence checked

- Stride Rite sizing help, accessed 2026-11-09: https://www.striderite.com/pages/sizing-help — states age is not a reliable size proxy except for babies and links fit guidance.
- Stride Rite FAQ, accessed 2026-11-09: https://www.striderite.com/pages/stride-rite-faq — describes home measurement and printable chart options.
- Running Shoe Deals methodology, accessed 2026-11-09: https://bestrunningshoedeals.com/methodology — describes matching models across 44 stores and size-specific price tracking; useful competitive benchmark.
- Ian’s Shoelace Site, accessed 2026-11-09: https://www.fieggen.com/shoelace/ — primary practical reference for lacing patterns and lace length guidance; cite the exact method/table used in the eventual calculator.
- eBay Browse API overview, accessed 2026-11-09: https://developer.ebay.com/api-docs/buy/browse/overview.html — official API documentation; credentials remain an owner gate.
- Shopify storefront docs, accessed 2026-11-09: https://shopify.dev/docs/api/storefront — official documentation; use a supported Storefront API with owner-provided access rather than assuming an exposed catalog endpoint is licensed.

## Limitations

This quick web pass confirms named competitors and primary sizing/API references, but does not establish market size, retailer catalog reuse rights, or a durable apparel-wide open dataset. Those need source-by-source legal/coverage checks before automated ingestion. Requested 390 px and 1280 px UI screenshots belong with the implemented pages and should be generated from the running local service after the UI changes.
