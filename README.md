# ios-chart-signal-audit

**Audit *why* iOS apps are moving on Apple App Store charts** by joining stored chart snapshots (`GET /v1/charts`) with batch paid-ad, organic content, and US ASO keyword signals (`GET /v1/market/signals`) from the [PeekPanda](https://peekpanda.com) API — in **2 API calls per run**, with zero npm dependencies.

- **Interactive browser explorer:** https://fdarkaou.github.io/ios-chart-signal-audit/
- **Runtime:** Node.js 18+ (pure ESM, zero external packages)

## What it solves

A raw App Store chart rank jump (`+28` places overnight) tells you *what* moved, not *what drove it*.

`ios-chart-signal-audit` fetches a stored Apple chart slice (`gainers`, `new-entrants`, `new-releases`, `rankings`, or `losers`) across any supported storefront (`us`, `gb`, `fr`, `de`, `br`, `be`, `jp`, `kr`, `cn`, `ru`), batch-annotates every ranked `storeId` in a single `GET /v1/market/signals` call, and classifies each mover into an evidence-backed driver profile:

| Driver | Meaning |
|---|---|
| **Multi-channel** | Two or more active channels observed simultaneously (Paid ads, Organic, ASO) |
| **Paid-ad push** | Active live paid ads (highlighting 7-day launch velocity, dominant format, and App Store vs web funnel share) |
| **Organic surge** | Matched viral TikTok / Instagram / Threads posts with meaningful view traction |
| **ASO search moat** | Strong US App Store search footprint (top-3 / top-10 ranked searches) |
| **Unexplained move** | Paid-ad collection is `fresh` (no ads found), no organic or strong ASO driver — likely PR, press, seasonal demand, or App Store featuring |
| **Uncollected** | `paidCollection.freshness` is `never` — never mislabeled as zero ads; surfaced separately with store IDs |

## Quick start

1. Set your PeekPanda API key (either `PEEKPANDA_API_KEY` env var or `~/.config/peekpanda/api_key`).
2. Run a chart audit:

```bash
# US Health & Fitness Free gainers (top 30)
node bin/chart-signals.mjs --country us --category health-and-fitness --chart free --view gainers --limit 30

# Overall US Top Grossing new entrants as CSV
node bin/chart-signals.mjs --country us --category all --chart grossing --view new-entrants --format csv > entrants.csv

# Weekly snapshot loop with diff + Slack/Discord digest
node bin/chart-signals.mjs \
  --country us \
  --category productivity \
  --view gainers \
  --min-move 5 \
  --prev snapshots/last-week.json \
  --save snapshots/this-week.json \
  --webhook "$SLACK_WEBHOOK_URL"
```

### Offline re-filtering & browser inspection

Save any run as JSON (`--save run.json` or `--format json > run.json`), then either:

- Re-filter or convert offline with zero API calls:
  ```bash
  node bin/chart-signals.mjs --input run.json --driver paid-push --format csv
  ```
- Drop `run.json` (and an optional previous snapshot) into the [static browser explorer](https://fdarkaou.github.io/ios-chart-signal-audit/) — everything runs client-side in your browser.

## CLI options

| Flag | Default | Description |
|---|---|---|
| `--country <code>` | `us` | Storefront: `us`, `gb`, `fr`, `de`, `br`, `be`, `jp`, `kr`, `cn`, `ru` |
| `--category <id\|slug>` | `all` | `"all"`, numeric Apple category ID (e.g. `6013`), or slug (`health-and-fitness`, `productivity`, `finance`, `photo-and-video`, etc.) |
| `--chart <type>` | `free` | `free`, `paid`, or `grossing` (chart position, not revenue dollars) |
| `--view <slice>` | `gainers` | `rankings`, `gainers`, `losers`, `new-entrants`, or `new-releases` |
| `--limit <1-100>` | `30` | Chart rows to inspect |
| `--min-move <int>` | — | Only keep rows with rank gain `>= N` |
| `--driver <name>` | — | Filter: `multi-channel`, `paid-push`, `organic-surge`, `aso-moat`, `unexplained`, `uncollected` |
| `--format <type>` | `md` | `md`, `csv`, or `json` |
| `--save <path>` | — | Save full JSON report to disk |
| `--prev <path>` | — | Diff against an earlier saved JSON report |
| `--input <path>` | — | Offline mode: load an existing JSON report without calling the API |
| `--webhook <url>` | — | Send digest to a Slack or Discord webhook |
| `--api-key-file <path>` | `~/.config/peekpanda/api_key` | Read API key from a file when `PEEKPANDA_API_KEY` is unset |

## Data honesty boundaries

- **iOS App Store only** — no Android coverage or cross-platform totals.
- **Uncollected ≠ zero** — streams that have never been collected (`null` or `paidCollection.freshness: "never"`) render as `—`, never `0`.
- **Grossing is a chart position**, not a dollar figure.
- **Download & revenue estimates** are PeekPanda worldwide monthly App Store models (ranges or `<5k/mo` below-floor), never measured figures; revenue estimates reflect App Store revenue only (excluding external web checkout).
- **Organic content matches** are suggested matches, not proof of account ownership.
- **ASO keyword signals** cover US English App Store searches only; popularity is a directional 0–100 score, not a search count.

## Running tests

```bash
npm test
```

## License

MIT — built for inspecting stored iOS App Store evidence from [PeekPanda](https://peekpanda.com).
