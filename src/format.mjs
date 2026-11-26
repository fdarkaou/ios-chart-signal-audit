export function formatCompactNumber(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(Math.round(n));
}

export function formatMovement(move, status) {
  if (status === "new_entrant" || status === "new-entrant") return "NEW";
  if (move === null || move === undefined) return "—";
  if (move > 0) return `+${move}`;
  return String(move);
}

export function formatEstimate(est, isCurrency = false) {
  if (!est) return "—";
  const prefix = isCurrency ? "$" : "";
  if (est.kind === "below_floor") {
    return `<${prefix}${formatCompactNumber(est.ceiling ?? 5000)}/mo`;
  }
  if (est.kind === "range") {
    return `${prefix}${formatCompactNumber(est.low)}–${prefix}${formatCompactNumber(est.high)}/mo`;
  }
  return "—";
}

export function formatPaidCell(item) {
  if (item.paid && typeof item.paid.liveAds === "number") {
    const recent = item.paid.startedLast7Days ? ` (+${item.paid.startedLast7Days} 7d)` : "";
    const staleTag = item.paidStatus.freshness === "stale" ? " [stale]" : "";
    return `${formatCompactNumber(item.paid.liveAds)} live${recent}${staleTag}`;
  }
  if (item.paidStatus.state === "none_found") return "0 found (fresh)";
  if (item.paidStatus.state === "none_found_stale") return "0 found (stale)";
  return "— (uncollected)";
}

export function formatOrganicCell(item) {
  if (!item.organic || !item.organic.matchedPosts) return "—";
  return `${item.organic.matchedPosts} posts · ${formatCompactNumber(item.organic.views)} views`;
}

export function formatKeywordsCell(item) {
  if (!item.keywords || !item.keywords.ranked) return "—";
  const best = item.keywords.best?.query ? ` ("${item.keywords.best.query}" #${item.keywords.best.position})` : "";
  return `${formatCompactNumber(item.keywords.ranked)} (${item.keywords.top10 ?? 0} top-10)${best}`;
}

export function formatMarkdown(report, diff = null) {
  const { query, snapshot, totals, items } = report;
  const lines = [];

  lines.push(
    `# iOS Chart Signal Audit — ${query.countryName} · ${query.categoryName} (${query.chartType} / ${query.view})`,
  );
  lines.push("");
  lines.push(
    `- **Chart day:** ${snapshot.day || "—"} (previous: ${snapshot.previousDay || "—"}, depth: ${snapshot.depth ?? "—"})`,
  );
  lines.push(
    `- **Signal timestamps:** ASO US keywords observed ${snapshot.keywordsObservedAt ? snapshot.keywordsObservedAt.slice(0, 10) : "—"} · Organic views counted ${snapshot.organicViewsCountedAt ? snapshot.organicViewsCountedAt.slice(0, 10) : "—"}`,
  );
  lines.push(
    `- **Summary (${totals.shown} apps):** ${totals.driverCounts["multi-channel"] || 0} multi-channel · ${totals.driverCounts["paid-push"] || 0} paid-ad push · ${totals.driverCounts["organic-surge"] || 0} organic surge · ${totals.driverCounts["aso-moat"] || 0} ASO moat · ${totals.driverCounts.unexplained || 0} unexplained · ${totals.driverCounts.uncollected || 0} uncollected`,
  );
  lines.push("");

  if (items.length === 0) {
    lines.push("_No chart rows matched the active filters._");
  } else {
    lines.push("| Rank | Move | App | Driver | Paid Ads | Organic (matched) | US ASO Keywords | Est. Monthly Installs (WW) |");
    lines.push("|---:|---:|---|---|---|---|---|---|");
    for (const item of items) {
      const appName = item.name.replace(/\|/g, "\\|");
      const appCell = item.appUrl ? `[${appName}](${item.appUrl})` : appName;
      lines.push(
        `| #${item.rank ?? "—"} | ${formatMovement(item.movement, item.status)} | ${appCell} | ${item.driverLabel} | ${formatPaidCell(item)} | ${formatOrganicCell(item)} | ${formatKeywordsCell(item).replace(/\|/g, "\\|")} | ${formatEstimate(item.estimates?.monthlyInstalls, false)} |`,
      );
    }
  }

  const uncollected = items.filter((i) => i.paidStatus.state === "uncollected");
  if (uncollected.length > 0) {
    lines.push("");
    lines.push("## Uncollected Paid-Ad Evidence");
    lines.push(
      "These movers have `paidCollection.freshness = never` (not zero ads — PeekPanda has not collected paid-ad evidence for them yet):",
    );
    lines.push("");
    for (const item of uncollected.slice(0, 15)) {
      lines.push(`- **${item.name}** (\`storeId: ${item.storeId}\`, rank #${item.rank ?? "—"}, move ${formatMovement(item.movement, item.status)})`);
    }
  }

  if (diff) {
    lines.push("");
    lines.push(`## Diff vs Previous Snapshot (${diff.previousDay || "prior"})`);
    lines.push(
      `- **Entered:** ${diff.entered.length} · **Exited:** ${diff.exited.length} · **Rank shifts:** ${diff.rankMovers.length} · **Live-ad shifts:** ${diff.adRamps.length} · **Driver shifts:** ${diff.driverShifts.length}`,
    );
    if (diff.entered.length > 0) {
      lines.push(
        `- **New on list:** ${diff.entered.slice(0, 8).map((e) => `${e.name} (#${e.rank ?? "—"}, ${e.driverLabel})`).join(", ")}`,
      );
    }
    if (diff.adRamps.length > 0) {
      lines.push(
        `- **Paid-ad deltas:** ${diff.adRamps.slice(0, 6).map((a) => `${a.name} (${a.delta > 0 ? "+" : ""}${a.delta} live → ${a.liveAds})`).join(", ")}`,
      );
    }
    if (diff.driverShifts.length > 0) {
      lines.push(
        `- **Driver transitions:** ${diff.driverShifts.slice(0, 6).map((s) => `${s.name} (${s.from} → ${s.to})`).join(", ")}`,
      );
    }
  }

  lines.push("");
  lines.push(
    "_Data honesty notes: iOS App Store only. Grossing is a chart position, not dollars. Estimates are PeekPanda worldwide monthly App Store models, never measured data. Organic matches are suggestions, not proof of ownership. Uncollected streams display as `—`, never zero. Powered by [PeekPanda](https://peekpanda.com)._",
  );

  return `${lines.join("\n")}\n`;
}

function csvEscape(value) {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function formatCsv(report) {
  const headers = [
    "day",
    "country",
    "category_id",
    "chart_type",
    "view",
    "rank",
    "previous_rank",
    "movement",
    "store_id",
    "name",
    "developer",
    "driver",
    "channels",
    "paid_freshness",
    "live_ads",
    "started_last_7d",
    "median_days_live",
    "dominant_ad_format",
    "web_dest_pct",
    "organic_posts",
    "organic_views",
    "aso_ranked",
    "aso_top10",
    "aso_best_query",
    "est_installs_mid_ww",
    "est_revenue_mid_ww_usd",
  ];

  const rows = [headers.join(",")];
  for (const item of report.items) {
    const vals = [
      report.snapshot.day,
      report.query.country,
      report.query.categoryId,
      report.query.chartType,
      report.query.view,
      item.rank,
      item.previousRank,
      item.movement,
      item.storeId,
      item.name,
      item.developer,
      item.driver,
      item.channels.join("|"),
      item.paidStatus.freshness,
      item.paid?.liveAds ?? "",
      item.paid?.startedLast7Days ?? "",
      item.paid?.medianDaysLive ?? "",
      item.paidMomentum.dominantFormat ?? "",
      item.paidMomentum.webSharePct ?? "",
      item.organic?.matchedPosts ?? "",
      item.organic?.views ?? "",
      item.keywords?.ranked ?? "",
      item.keywords?.top10 ?? "",
      item.keywords?.best?.query ?? "",
      item.estimates?.monthlyInstalls?.kind === "range" ? item.estimates.monthlyInstalls.mid : "",
      item.estimates?.monthlyRevenue?.kind === "range" ? item.estimates.monthlyRevenue.mid : "",
    ];
    rows.push(vals.map(csvEscape).join(","));
  }
  return `${rows.join("\n")}\n`;
}

export function buildWebhookPayload(report, diff = null, webhookUrl = "") {
  const { query, snapshot, totals, items } = report;
  const topLines = items.slice(0, 6).map((item) => {
    const move = formatMovement(item.movement, item.status);
    return `• #${item.rank ?? "—"} (${move}) *${item.name}* — ${item.driverLabel} | Ads: ${formatPaidCell(item)} | Org: ${formatOrganicCell(item)}`;
  });

  const header = `iOS Chart Signal Audit (${query.country.toUpperCase()} · ${query.categoryName} · ${query.chartType}/${query.view} · ${snapshot.day || "—"})`;
  const summary = `${totals.shown} apps: ${totals.driverCounts["multi-channel"] || 0} multi, ${totals.driverCounts["paid-push"] || 0} paid, ${totals.driverCounts["organic-surge"] || 0} organic, ${totals.driverCounts["aso-moat"] || 0} ASO, ${totals.driverCounts.uncollected || 0} uncollected`;
  const diffLine = diff
    ? `\nDiff vs ${diff.previousDay || "prior"}: +${diff.entered.length} entered, -${diff.exited.length} exited, ${diff.adRamps.length} ad shifts`
    : "";

  const text = `${header}\n${summary}${diffLine}\n\n${topLines.join("\n")}`;

  if (webhookUrl.includes("discord.com/api/webhooks") || webhookUrl.includes("discordapp.com/api/webhooks")) {
    return { content: text.replace(/\*([^*]+)\*/g, "**$1**") };
  }
  return { text };
}
