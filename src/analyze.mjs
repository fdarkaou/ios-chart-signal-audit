import { DRIVER_LABELS } from "./constants.mjs";

export function detectPaidMomentum(paid) {
  if (!paid || typeof paid.liveAds !== "number" || paid.liveAds <= 0) {
    return { active: false, ramping: false, dominantFormat: null, webSharePct: null };
  }

  const weekly = Array.isArray(paid.weeklyStarts) ? paid.weeklyStarts : [];
  let ramping = (paid.startedLast7Days ?? 0) > 0;
  if (!ramping && weekly.length >= 4) {
    const recent = (weekly.at(-1) ?? 0) + (weekly.at(-2) ?? 0);
    const prior = (weekly.at(-3) ?? 0) + (weekly.at(-4) ?? 0);
    if (recent > prior && recent >= 3) ramping = true;
  }

  const formats = paid.formats || {};
  const formatEntries = Object.entries(formats)
    .filter(([, n]) => typeof n === "number" && n > 0)
    .sort((a, b) => b[1] - a[1]);
  const dominantFormat = formatEntries[0]?.[0] ?? null;

  const dest = paid.destinations || {};
  const totalDest = (dest.appStore ?? 0) + (dest.playStore ?? 0) + (dest.web ?? 0);
  const webSharePct = totalDest > 0 ? Math.round(((dest.web ?? 0) / totalDest) * 100) : null;

  return { active: true, ramping, dominantFormat, webSharePct };
}

export function resolvePaidStatus(signal) {
  const freshness = signal?.paidCollection?.freshness ?? "never";
  const lastCollectedAt = signal?.paidCollection?.lastCollectedAt ?? null;
  if (signal?.paid) {
    return {
      state: signal.paid.liveAds > 0 ? "active" : "historical_only",
      freshness,
      lastCollectedAt,
    };
  }
  if (freshness === "fresh") {
    return { state: "none_found", freshness, lastCollectedAt };
  }
  if (freshness === "stale") {
    return { state: "none_found_stale", freshness, lastCollectedAt };
  }
  return { state: "uncollected", freshness: "never", lastCollectedAt };
}

export function classifyDriver(signal) {
  const paidStatus = resolvePaidStatus(signal);
  const paidMomentum = detectPaidMomentum(signal?.paid);
  const organic = signal?.organic ?? null;
  const keywords = signal?.keywords ?? null;

  const channels = [];
  if (paidMomentum.active) {
    channels.push("paid");
  }
  if (
    organic &&
    (organic.postsOverMillion > 0 ||
      (organic.views ?? 0) >= 100_000 ||
      (organic.matchedPosts ?? 0) >= 3)
  ) {
    channels.push("organic");
  }
  if (keywords && ((keywords.top10 ?? 0) >= 5 || (keywords.top3 ?? 0) >= 2)) {
    channels.push("aso");
  }

  let driver = "unexplained";
  if (channels.length >= 2) {
    driver = "multi-channel";
  } else if (channels.length === 1) {
    if (channels[0] === "paid") driver = "paid-push";
    else if (channels[0] === "organic") driver = "organic-surge";
    else driver = "aso-moat";
  } else if (paidStatus.state === "uncollected") {
    driver = "uncollected";
  }

  return {
    driver,
    driverLabel: DRIVER_LABELS[driver],
    channels,
    paidStatus,
    paidMomentum,
  };
}

function summarizeEstimate(est) {
  if (!est) return null;
  if (est.kind === "range" && est.range) {
    return {
      kind: "range",
      low: est.range.low ?? null,
      mid: est.range.mid ?? null,
      high: est.range.high ?? null,
      observedAt: est.observedAt ?? null,
    };
  }
  if (est.kind === "below_floor") {
    return {
      kind: "below_floor",
      ceiling: est.ceiling ?? 5000,
      observedAt: est.observedAt ?? null,
    };
  }
  return null;
}

export function analyzeChartSignals(
  { chart, signals },
  { minMove = null, driverFilter = null } = {},
) {
  const signalMap = new Map();
  for (const app of signals?.apps || []) {
    signalMap.set(String(app.storeId), app);
  }

  const allItems = (chart?.data || []).map((row) => {
    const storeId = String(row.storeId);
    const sig = signalMap.get(storeId) || null;
    const classification = classifyDriver(sig);
    const history = Array.isArray(row.history)
      ? row.history.map((pt) => ({ day: pt.day, rank: pt.rank }))
      : [];

    return {
      storeId,
      name: row.name || sig?.name || `App ${storeId}`,
      developer: row.developer || null,
      iconUrl: sig?.iconUrl || row.iconUrl || null,
      appUrl: row.appUrl || null,
      categoryId: row.categoryId || null,
      categoryName: row.categoryName || null,
      releaseDate: row.releaseDate || null,
      price: typeof row.price === "number" ? row.price : null,
      currency: row.currency || null,
      rating: typeof row.rating === "number" ? Number(row.rating.toFixed(2)) : null,
      ratingCount: typeof row.ratingCount === "number" ? row.ratingCount : null,
      rank: typeof row.rank === "number" ? row.rank : null,
      previousRank: typeof row.previousRank === "number" ? row.previousRank : null,
      movement: typeof row.movement === "number" ? row.movement : null,
      status: row.status || null,
      inCatalogue: Boolean(row.inCatalogue),
      history,
      estimates: row.estimates
        ? {
            monthlyInstalls: summarizeEstimate(row.estimates.monthlyInstalls),
            monthlyRevenue: summarizeEstimate(row.estimates.monthlyRevenue),
            currency: row.estimates.currency || "USD",
          }
        : null,
      driver: classification.driver,
      driverLabel: classification.driverLabel,
      channels: classification.channels,
      paidStatus: classification.paidStatus,
      paidMomentum: classification.paidMomentum,
      paid: sig?.paid ?? null,
      organic: sig?.organic ?? null,
      keywords: sig?.keywords ?? null,
    };
  });

  const filtered = allItems.filter((item) => {
    if (typeof minMove === "number" && Number.isFinite(minMove)) {
      if (item.movement === null || item.movement < minMove) return false;
    }
    if (driverFilter && item.driver !== driverFilter) {
      return false;
    }
    return true;
  });

  const driverCounts = {};
  for (const key of Object.keys(DRIVER_LABELS)) {
    driverCounts[key] = 0;
  }
  let withLiveAds = 0;
  let rampingAds = 0;
  let withOrganic = 0;
  let withKeywords = 0;
  let uncollectedPaid = 0;

  for (const item of filtered) {
    driverCounts[item.driver] = (driverCounts[item.driver] || 0) + 1;
    if ((item.paid?.liveAds ?? 0) > 0) withLiveAds += 1;
    if (item.paidMomentum.ramping) rampingAds += 1;
    if ((item.organic?.matchedPosts ?? 0) > 0) withOrganic += 1;
    if ((item.keywords?.ranked ?? 0) > 0) withKeywords += 1;
    if (item.paidStatus.state === "uncollected") uncollectedPaid += 1;
  }

  const categoryName =
    chart?.coverage?.categories?.find((c) => c.id === chart?.query?.categoryId)?.name ||
    chart?.query?.categoryId ||
    "Overall";
  const countryName =
    chart?.coverage?.countries?.find((c) => c.code === chart?.query?.country)?.name ||
    (chart?.query?.country || "us").toUpperCase();

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    query: {
      country: chart?.query?.country || signals?.country || "us",
      countryName,
      categoryId: chart?.query?.categoryId || "all",
      categoryName,
      chartType: chart?.query?.chartType || "free",
      view: chart?.query?.view || "rankings",
      limit: chart?.query?.limit || allItems.length,
      minMove: minMove ?? null,
      driverFilter: driverFilter ?? null,
    },
    snapshot: {
      day: chart?.snapshot?.day || null,
      previousDay: chart?.snapshot?.previousDay || null,
      fetchedAt: chart?.snapshot?.fetchedAt || null,
      depth: chart?.snapshot?.depth ?? null,
      stale: Boolean(chart?.snapshot?.stale),
      weeks: Array.isArray(signals?.weeks) ? signals.weeks : [],
      keywordsObservedAt: signals?.keywordsObservedAt || null,
      organicViewsCountedAt: signals?.organicViewsCountedAt || null,
    },
    chartSummary: chart?.summary || null,
    totals: {
      totalBeforeFilter: allItems.length,
      shown: filtered.length,
      withLiveAds,
      rampingAds,
      withOrganic,
      withKeywords,
      uncollectedPaid,
      driverCounts,
    },
    items: filtered,
  };
}
