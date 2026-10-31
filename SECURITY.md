# Security policy

OpenVibe is run in the open, and we want to hear about security problems before anyone else does.

## Reporting a vulnerability

Email **contact@openvibe.network** with "security" in the subject. Please include what you found, where (URL,
repository, file), how to reproduce it, and what an attacker could do with it. Do not open a public GitHub issue for
a vulnerability, and do not test against other people's accounts, data or streams.

We reply within 7 days, keep you updated while we fix it, and credit you when the fix ships if you would like.

## Scope

Every OpenVibe service and site (open.shoes, openvibe.live, openvibe.network, openvibe.today, openvibe.tools,
openvibe.media, openvibe.community, openvibe.games and the other openvibe.* domains) and every repository under
github.com/OpenVibers. Machine-readable contact details are at `/.well-known/security.txt` on each site.

## What OpenVibe.Shoes holds

- Public models, offers, daily snapshots, drops and cited facts: the stores' public listings, prices, all-in
  inputs, sizes, conditions, colourways, source pages, check times and read times. They are the network's public
  record, not a person's row, so they are not exported or erased with an account.
- A person's watches: the subject id, the kind (a price watch or a pasted link), the model/size/condition, the
  threshold and a public URL. These are exported and erased with an account.
- Network session tokens only in httpOnly cookies (`shoes_at`, `shoes_rt`); no token is stored in the database,
  rendered into a page or logged. The Watch service token and eBay key pair are environment values and never
  stored or logged.
- A pasted URL is checked by `openvibe-shared/egress` before it is handed to Watch; Shoes never fetches the URL
  itself, and Facebook Marketplace is never scraped.

The `/internal/events` account route is loopback only and refuses a proxied request; nginx answers 404 for
`/internal` and `/metrics`.

## Supported versions

Only the current `main` branch, which is what runs in production, receives fixes.
