#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { homedir } from "node:os";
import {
  DEFAULT_BASE_URL,
  VALID_CHARTS,
  VALID_COUNTRIES,
  VALID_DRIVERS,
  VALID_VIEWS,
  resolveCategoryId,
} from "../src/constants.mjs";
import { fetchChartWithSignals } from "../src/client.mjs";
import { analyzeChartSignals } from "../src/analyze.mjs";
import { diffReports } from "../src/diff.mjs";
import { buildWebhookPayload, formatCsv, formatMarkdown } from "../src/format.mjs";

const USAGE = `ios-chart-signal-audit — Audit why iOS apps are moving on Apple App Store charts

Usage:
  ios-chart-signal-audit [options]

Options:
  --country <code>       Storefront: us, gb, fr, de, br, be, jp, kr, cn, ru (default: us)
  --category <id|slug>   "all", numeric Apple ID (e.g. 6013), or slug like health-and-fitness (default: all)
  --chart <type>         free | paid | grossing (default: free)
  --view <slice>         rankings | gainers | losers | new-entrants | new-releases (default: gainers)
  --limit <1-100>        Max chart rows to inspect (default: 30)
  --min-move <int>       Only keep apps with rank movement >= N
  --driver <name>        Filter by driver: multi-channel | paid-push | organic-surge | aso-moat | unexplained | uncollected
  --format <type>        md | csv | json (default: md)
  --save <path>          Write full JSON report to file
  --prev <path>          Compare against a prior saved JSON report
  --input <path>         Offline mode: re-analyze or re-format a saved JSON report without API calls
  --webhook <url>        Post summary digest to a Slack or Discord webhook
  --api-key-file <path>  Read PeekPanda API key from file (default: ~/.config/peekpanda/api_key if PEEKPANDA_API_KEY unset)
  --tenancy <value>      Optional x-genviral-tenancy header
  --base-url <url>       API base URL (default: ${DEFAULT_BASE_URL})
  --help, -h             Show this help
`;

export function parseArgs(argv) {
  const opts = {
    country: "us",
    category: "all",
    chart: "free",
    view: "gainers",
    limit: 30,
    minMove: null,
    driver: null,
    format: "md",
    save: null,
    prev: null,
    input: null,
    webhook: null,
    apiKeyFile: null,
    tenancy: null,
    baseUrl: DEFAULT_BASE_URL,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) throw new Error(`Missing value for ${arg}`);
      i += 1;
      return argv[i];
    };

    if (arg === "--help" || arg === "-h") opts.help = true;
    else if (arg === "--country") opts.country = next().toLowerCase();
    else if (arg === "--category") opts.category = next();
    else if (arg === "--chart") opts.chart = next().toLowerCase();
    else if (arg === "--view") opts.view = next().toLowerCase();
    else if (arg === "--limit") opts.limit = Number(next());
    else if (arg === "--min-move") opts.minMove = Number(next());
    else if (arg === "--driver") opts.driver = next().toLowerCase();
    else if (arg === "--format") opts.format = next().toLowerCase();
    else if (arg === "--save") opts.save = next();
    else if (arg === "--prev") opts.prev = next();
    else if (arg === "--input") opts.input = next();
    else if (arg === "--webhook") opts.webhook = next();
    else if (arg === "--api-key-file") opts.apiKeyFile = next();
    else if (arg === "--tenancy") opts.tenancy = next();
    else if (arg === "--base-url") opts.baseUrl = next();
    else throw new Error(`Unknown argument: ${arg}`);
  }

  return opts;
}

function readApiKey(apiKeyFile) {
  if (process.env.PEEKPANDA_API_KEY && !apiKeyFile) {
    return process.env.PEEKPANDA_API_KEY.trim();
  }
  const filePath = apiKeyFile
    ? resolve(apiKeyFile)
    : resolve(homedir(), ".config/peekpanda/api_key");
  try {
    const key = readFileSync(filePath, "utf8").trim();
    if (!key) throw new Error(`API key file is empty: ${filePath}`);
    return key;
  } catch (err) {
    throw new Error(
      `Could not read PeekPanda API key. Set PEEKPANDA_API_KEY or create ${filePath}. (${err.message})`,
    );
  }
}

function refilterReport(report, { minMove, driver }) {
  const items = (report.items || []).filter((item) => {
    if (typeof minMove === "number" && Number.isFinite(minMove)) {
      if (item.movement === null || item.movement < minMove) return false;
    }
    if (driver && item.driver !== driver) return false;
    return true;
  });

  const driverCounts = {};
  let withLiveAds = 0;
  let rampingAds = 0;
  let withOrganic = 0;
  let withKeywords = 0;
  let uncollectedPaid = 0;

  for (const item of items) {
    driverCounts[item.driver] = (driverCounts[item.driver] || 0) + 1;
    if ((item.paid?.liveAds ?? 0) > 0) withLiveAds += 1;
    if (item.paidMomentum?.ramping) rampingAds += 1;
    if ((item.organic?.matchedPosts ?? 0) > 0) withOrganic += 1;
    if ((item.keywords?.ranked ?? 0) > 0) withKeywords += 1;
    if (item.paidStatus?.state === "uncollected") uncollectedPaid += 1;
  }

  return {
    ...report,
    query: { ...report.query, minMove: minMove ?? null, driverFilter: driver ?? null },
    totals: {
      totalBeforeFilter: report.items?.length ?? 0,
      shown: items.length,
      withLiveAds,
      rampingAds,
      withOrganic,
      withKeywords,
      uncollectedPaid,
      driverCounts,
    },
    items,
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    process.stdout.write(USAGE);
    return;
  }

  if (!VALID_COUNTRIES.has(opts.country)) {
    throw new Error(`Unsupported country "${opts.country}". Expected one of: ${[...VALID_COUNTRIES].join(", ")}`);
  }
  if (!VALID_CHARTS.has(opts.chart)) {
    throw new Error(`Unsupported chart "${opts.chart}". Expected: free, paid, grossing`);
  }
  if (!VALID_VIEWS.has(opts.view)) {
    throw new Error(`Unsupported view "${opts.view}". Expected: ${[...VALID_VIEWS].join(", ")}`);
  }
  if (!Number.isInteger(opts.limit) || opts.limit < 1 || opts.limit > 100) {
    throw new Error("--limit must be an integer between 1 and 100");
  }
  if (opts.driver && !VALID_DRIVERS.has(opts.driver)) {
    throw new Error(`Unsupported driver "${opts.driver}". Expected one of: ${[...VALID_DRIVERS].join(", ")}`);
  }
  if (!["md", "csv", "json"].includes(opts.format)) {
    throw new Error(`Unsupported format "${opts.format}". Expected: md, csv, json`);
  }

  let report;
  if (opts.input) {
    const loaded = JSON.parse(readFileSync(resolve(opts.input), "utf8"));
    report = refilterReport(loaded, { minMove: opts.minMove, driver: opts.driver });
  } else {
    const categoryId = resolveCategoryId(opts.category);
    const apiKey = readApiKey(opts.apiKeyFile);
    const raw = await fetchChartWithSignals(
      {
        country: opts.country,
        categoryId,
        chartType: opts.chart,
        view: opts.view,
        limit: opts.limit,
      },
      { apiKey, baseUrl: opts.baseUrl, tenancy: opts.tenancy },
    );
    report = analyzeChartSignals(raw, { minMove: opts.minMove, driverFilter: opts.driver });
  }

  let diff = null;
  if (opts.prev) {
    const prevReport = JSON.parse(readFileSync(resolve(opts.prev), "utf8"));
    diff = diffReports(report, prevReport);
  }

  if (opts.save) {
    const outPath = resolve(opts.save);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }

  if (opts.webhook) {
    const payload = buildWebhookPayload(report, diff, opts.webhook);
    const res = await fetch(opts.webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      throw new Error(`Webhook POST failed with HTTP ${res.status}`);
    }
  }

  if (opts.format === "json") {
    const out = diff ? { ...report, diff } : report;
    process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
  } else if (opts.format === "csv") {
    process.stdout.write(formatCsv(report));
  } else {
    process.stdout.write(formatMarkdown(report, diff));
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname);
if (isMain) {
  main().catch((err) => {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exitCode = 1;
  });
}
