import test from "node:test";
import assert from "node:assert/strict";
import { resolveCategoryId } from "../src/constants.mjs";
import { analyzeChartSignals, classifyDriver, detectPaidMomentum, resolvePaidStatus } from "../src/analyze.mjs";
import { diffReports } from "../src/diff.mjs";
import { buildWebhookPayload, formatCsv, formatMarkdown } from "../src/format.mjs";

const SAMPLE_CHART = {
  query: { country: "us", categoryId: "6013", chartType: "free", view: "gainers", limit: 10 },
  coverage: {
    countries: [{ code: "us", name: "United States" }],
    categories: [{ id: "6013", name: "Health & Fitness" }],
  },
  snapshot: {
    day: "2026-11-26",
    previousDay: "2026-11-25",
    fetchedAt: "2026-11-26T01:00:00.000Z",
    depth: 100,
    stale: false,
  },
  summary: { trackedApps: 100, rankedApps: 100, gainers: 40, losers: 40, newEntrants: 3, newReleases: 1 },
  data: [
    {
      storeId: "1001",
      name: "CalTrack, Pro",
      developer: "Fit Labs",
      appUrl: "https://apps.apple.com/us/app/id1001",
      categoryId: "6013",
      categoryName: "Health & Fitness",
      rank: 12,
      previousRank: 28,
      movement: 16,
      status: "ranked",
      inCatalogue: true,
      history: [{ day: "2026-11-25", rank: 28 }, { day: "2026-11-26", rank: 12 }],
      estimates: {
        monthlyInstalls: { kind: "range", scope: "worldwide", range: { low: 50000, mid: 100000, high: 200000 } },
        monthlyRevenue: { kind: "below_floor", scope: "worldwide", ceiling: 5000 },
        currency: "USD",
      },
    },
    {
      storeId: "1002",
      name: "Silent Climber",
      developer: "Quiet Co",
      rank: 45,
      previousRank: 70,
      movement: 25,
      status: "ranked",
      inCatalogue: true,
      history: [],
    },
    {
      storeId: "1003",
      name: "Uncollected App",
      developer: "New Studio",
      rank: 60,
      previousRank: 64,
      movement: 4,
      status: "ranked",
      inCatalogue: false,
      history: [],
    },
  ],
};

const SAMPLE_SIGNALS = {
  country: "us",
  weeks: ["2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26", "2026-11-02", "2026-11-09", "2026-11-16", "2026-11-23"],
  keywordsObservedAt: "2026-11-26T01:20:00.000Z",
  organicViewsCountedAt: "2026-11-26T05:00:00.000Z",
  apps: [
    {
      storeId: "1001",
      paid: {
        totalAds: 120,
        liveAds: 42,
        startedLast7Days: 11,
        medianDaysLive: 14,
        longestDaysLive: 90,
        formats: { video: 100, image: 20, dynamic: 0 },
        destinations: { appStore: 90, playStore: 0, web: 30 },
        weeklyStarts: [5, 6, 4, 5, 8, 9, 15, 11],
      },
      organic: {
        matchedPosts: 6,
        views: 2_400_000,
        medianViews: 210_000,
        bestPostViews: 1_500_000,
        postsOverMillion: 1,
        platforms: { TikTok: 6 },
      },
      keywords: {
        ranked: 500,
        top1: 5,
        top3: 18,
        top10: 62,
        top50: 210,
        best: { query: "calorie tracker", position: 2, popularity: 68 },
      },
      paidCollection: { freshness: "fresh", lastCollectedAt: "2026-11-26T00:10:00.000Z" },
    },
    {
      storeId: "1002",
      paid: null,
      organic: null,
      keywords: { ranked: 12, top1: 0, top3: 0, top10: 1, top50: 4, best: { query: "silent", position: 9, popularity: 22 } },
      paidCollection: { freshness: "fresh", lastCollectedAt: "2026-11-25T20:00:00.000Z" },
    },
    {
      storeId: "1003",
      paid: null,
      organic: null,
      keywords: null,
      paidCollection: { freshness: "never", lastCollectedAt: null },
    },
  ],
};

test("resolveCategoryId handles slugs, numeric IDs, and rejects unknown values", () => {
  assert.equal(resolveCategoryId("all"), "all");
  assert.equal(resolveCategoryId("health-and-fitness"), "6013");
  assert.equal(resolveCategoryId("Health & Fitness"), "6013");
  assert.equal(resolveCategoryId("6007"), "6007");
  assert.throws(() => resolveCategoryId("nonexistent-shelf"), /Unknown category/);
});

test("resolvePaidStatus distinguishes fresh zero-found from never-collected", () => {
  assert.equal(resolvePaidStatus({ paid: null, paidCollection: { freshness: "fresh" } }).state, "none_found");
  assert.equal(resolvePaidStatus({ paid: null, paidCollection: { freshness: "never" } }).state, "uncollected");
  assert.equal(resolvePaidStatus({ paid: { liveAds: 10 }, paidCollection: { freshness: "stale" } }).state, "active");
});

test("detectPaidMomentum computes ramping, dominant format, and web destination share", () => {
  const m = detectPaidMomentum(SAMPLE_SIGNALS.apps[0].paid);
  assert.equal(m.active, true);
  assert.equal(m.ramping, true);
  assert.equal(m.dominantFormat, "video");
  assert.equal(m.webSharePct, 25);
});

test("analyzeChartSignals classifies multi-channel, unexplained, and uncollected honestly", () => {
  const report = analyzeChartSignals({ chart: SAMPLE_CHART, signals: SAMPLE_SIGNALS });
  assert.equal(report.totals.shown, 3);

  const [multi, unexplained, uncollected] = report.items;
  assert.equal(multi.driver, "multi-channel");
  assert.deepEqual(multi.channels, ["paid", "organic", "aso"]);

  assert.equal(unexplained.driver, "unexplained");
  assert.equal(unexplained.paidStatus.state, "none_found");

  assert.equal(uncollected.driver, "uncollected");
  assert.equal(uncollected.paidStatus.state, "uncollected");
  assert.equal(report.totals.uncollectedPaid, 1);

  const filtered = analyzeChartSignals(
    { chart: SAMPLE_CHART, signals: SAMPLE_SIGNALS },
    { minMove: 10 },
  );
  assert.equal(filtered.totals.shown, 2);
  assert.equal(filtered.totals.totalBeforeFilter, 3);
});

test("classifyDriver identifies single-channel drivers accurately", () => {
  const paidOnly = classifyDriver({
    paid: { liveAds: 12, startedLast7Days: 3 },
    organic: null,
    keywords: null,
    paidCollection: { freshness: "fresh" },
  });
  assert.equal(paidOnly.driver, "paid-push");

  const organicOnly = classifyDriver({
    paid: null,
    organic: { matchedPosts: 4, views: 500_000, postsOverMillion: 0 },
    keywords: null,
    paidCollection: { freshness: "fresh" },
  });
  assert.equal(organicOnly.driver, "organic-surge");

  const asoOnly = classifyDriver({
    paid: null,
    organic: null,
    keywords: { ranked: 100, top10: 12, top3: 4 },
    paidCollection: { freshness: "fresh" },
  });
  assert.equal(asoOnly.driver, "aso-moat");
});

test("diffReports detects entries, exits, rank deltas, live-ad ramps, and driver shifts", () => {
  const previous = analyzeChartSignals({ chart: SAMPLE_CHART, signals: SAMPLE_SIGNALS });

  const nextChart = structuredClone(SAMPLE_CHART);
  nextChart.snapshot.day = "2026-11-27";
  nextChart.data[0].rank = 8;
  nextChart.data.pop(); // remove 1003
  nextChart.data.push({
    storeId: "1004",
    name: "Fresh Entrant",
    rank: 51,
    previousRank: null,
    movement: null,
    status: "new_entrant",
  });

  const nextSignals = structuredClone(SAMPLE_SIGNALS);
  nextSignals.apps[0].paid.liveAds = 65;
  nextSignals.apps[1].paid = { liveAds: 9, startedLast7Days: 9 };

  const current = analyzeChartSignals({ chart: nextChart, signals: nextSignals });
  const diff = diffReports(current, previous);

  assert.equal(diff.entered.length, 1);
  assert.equal(diff.entered[0].storeId, "1004");
  assert.equal(diff.exited.length, 1);
  assert.equal(diff.exited[0].storeId, "1003");
  assert.equal(diff.rankMovers[0].rankGain, 4);
  assert.equal(diff.adRamps.some((r) => r.storeId === "1001" && r.delta === 23), true);
  assert.equal(diff.driverShifts.some((s) => s.storeId === "1002" && s.from === "unexplained" && s.to === "paid-push"), true);
});

test("formatMarkdown, formatCsv, and buildWebhookPayload preserve commas, dashes, and webhook format", () => {
  const report = analyzeChartSignals({ chart: SAMPLE_CHART, signals: SAMPLE_SIGNALS });

  const md = formatMarkdown(report);
  assert.match(md, /Uncollected Paid-Ad Evidence/);
  assert.match(md, /— \(uncollected\)/);
  assert.match(md, /0 found \(fresh\)/);
  assert.match(md, /https:\/\/peekpanda\.com/);

  const csv = formatCsv(report);
  assert.match(csv, /"CalTrack, Pro"/);
  assert.equal(csv.trim().split("\n").length, 4);

  const slack = buildWebhookPayload(report, null, "https://hooks.slack.com/services/T/B/X");
  assert.ok(typeof slack.text === "string");
  const discord = buildWebhookPayload(report, null, "https://discord.com/api/webhooks/123/abc");
  assert.ok(typeof discord.content === "string");
  assert.match(discord.content, /\*\*CalTrack, Pro\*\*/);
});
