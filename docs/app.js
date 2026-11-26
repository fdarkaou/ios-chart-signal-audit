const DRIVER_ORDER = [
  { key: "all", label: "Total shown" },
  { key: "multi-channel", label: "Multi-channel" },
  { key: "paid-push", label: "Paid-ad push" },
  { key: "organic-surge", label: "Organic surge" },
  { key: "aso-moat", label: "ASO search moat" },
  { key: "unexplained", label: "Unexplained move" },
  { key: "uncollected", label: "Uncollected" },
];

let state = {
  report: null,
  prevReport: null,
  search: "",
  driver: "all",
  sort: "movement",
  expandedId: null,
};

function fmtCompact(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(Math.round(n));
}

function fmtEstimate(est, isCurrency = false) {
  if (!est) return "—";
  const p = isCurrency ? "$" : "";
  if (est.kind === "below_floor") return `<${p}${fmtCompact(est.ceiling ?? 5000)}/mo`;
  if (est.kind === "range") return `${p}${fmtCompact(est.low)}–${p}${fmtCompact(est.high)}/mo`;
  return "—";
}

function esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtPaid(item) {
  if (item.paid && typeof item.paid.liveAds === "number") {
    const plus = item.paid.startedLast7Days ? ` (+${item.paid.startedLast7Days} 7d)` : "";
    const stale = item.paidStatus?.freshness === "stale" ? " · stale" : "";
    return `${fmtCompact(item.paid.liveAds)} live${plus}${stale}`;
  }
  if (item.paidStatus?.state === "none_found") return "0 found (fresh)";
  if (item.paidStatus?.state === "none_found_stale") return "0 found (stale)";
  return "— (uncollected)";
}

function fmtOrganic(item) {
  if (!item.organic?.matchedPosts) return "—";
  return `${item.organic.matchedPosts} posts · ${fmtCompact(item.organic.views)} views`;
}

function fmtKeywords(item) {
  if (!item.keywords?.ranked) return "—";
  const best = item.keywords.best?.query
    ? ` · "${item.keywords.best.query}" #${item.keywords.best.position}`
    : "";
  return `${fmtCompact(item.keywords.ranked)} (${item.keywords.top10 ?? 0} top-10)${best}`;
}

function renderMeta() {
  const el = document.getElementById("snapshot-meta");
  const r = state.report;
  if (!r) return;
  const q = r.query || {};
  const s = r.snapshot || {};
  el.innerHTML = `
    <span><strong>Slice:</strong> ${esc(q.countryName || q.country)} · ${esc(q.categoryName || q.categoryId)} · ${esc(q.chartType)} / ${esc(q.view)}</span>
    <span><strong>Chart day:</strong> ${esc(s.day || "—")} (prev ${esc(s.previousDay || "—")})</span>
    <span><strong>ASO observed:</strong> ${esc(s.keywordsObservedAt ? s.keywordsObservedAt.slice(0, 10) : "—")}</span>
    <span><strong>Organic views counted:</strong> ${esc(s.organicViewsCountedAt ? s.organicViewsCountedAt.slice(0, 10) : "—")}</span>
  `;
}

function renderKpis() {
  const grid = document.getElementById("kpi-grid");
  const r = state.report;
  if (!r) return;
  const counts = r.totals?.driverCounts || {};
  grid.innerHTML = DRIVER_ORDER.map(({ key, label }) => {
    const val = key === "all" ? (r.items?.length ?? 0) : (counts[key] || 0);
    const active = state.driver === key ? " active" : "";
    return `
      <button type="button" class="kpi-card${active}" data-driver="${esc(key)}">
        <span class="kpi-label">${esc(label)}</span>
        <span class="kpi-value">${val}</span>
      </button>
    `;
  }).join("");

  grid.querySelectorAll(".kpi-card").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.driver = btn.dataset.driver;
      document.getElementById("driver-select").value = state.driver;
      renderAll();
    });
  });
}

function renderDiffBanner() {
  const el = document.getElementById("diff-banner");
  if (!state.report || !state.prevReport) {
    el.hidden = true;
    return;
  }
  const prevMap = new Map((state.prevReport.items || []).map((i) => [String(i.storeId), i]));
  const currMap = new Map((state.report.items || []).map((i) => [String(i.storeId), i]));
  let entered = 0;
  let exited = 0;
  let adIncreased = 0;
  let driverChanged = 0;

  for (const item of state.report.items || []) {
    const p = prevMap.get(String(item.storeId));
    if (!p) {
      entered += 1;
      continue;
    }
    if ((item.paid?.liveAds ?? 0) > (p.paid?.liveAds ?? 0)) adIncreased += 1;
    if (item.driver !== p.driver) driverChanged += 1;
  }
  for (const p of state.prevReport.items || []) {
    if (!currMap.has(String(p.storeId))) exited += 1;
  }

  el.hidden = false;
  el.innerHTML = `<strong>Diff vs ${esc(state.prevReport.snapshot?.day || "previous JSON")}:</strong> +${entered} entered · -${exited} exited · ${adIncreased} ramped live paid ads · ${driverChanged} changed driver classification.`;
}

function buildSparkline(history) {
  if (!Array.isArray(history) || history.length < 2) return `<span class="muted">No multi-day history stored.</span>`;
  const ranks = history.map((h) => h.rank);
  const minR = Math.min(...ranks);
  const maxR = Math.max(...ranks);
  const span = Math.max(1, maxR - minR);
  const w = 190;
  const h = 42;
  const pts = history
    .map((pt, idx) => {
      const x = (idx / (history.length - 1)) * (w - 8) + 4;
      const y = ((pt.rank - minR) / span) * (h - 10) + 5;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return `
    <svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="Rank trajectory">
      <polyline fill="none" stroke="var(--accent)" stroke-width="2" points="${pts}" />
    </svg>
    <div class="muted" style="font-size:11.5px;">Best #${minR} · Worst #${maxR} (${history.length} pts)</div>
  `;
}

function buildDetailRow(item) {
  const weeks = state.report?.snapshot?.weeks || [];
  const starts = item.paid?.weeklyStarts || [];
  const maxStart = Math.max(1, ...starts);
  const barsHtml =
    starts.length > 0
      ? `<div class="bars" title="8-week paid ad launches">${starts
          .map((n, i) => {
            const pct = Math.max(6, Math.round((n / maxStart) * 100));
            return `<div class="bar-col" title="${esc(weeks[i] || `W${i + 1}`)}: ${n} new ads"><div class="bar-fill" style="height:${pct}%"></div></div>`;
          })
          .join("")}</div>`
      : `<div class="muted" style="font-size:12px;">No weekly paid-ad launch series stored.</div>`;

  const topKws = (item.keywords?.top || [])
    .slice(0, 5)
    .map((k) => {
      const pop = k.popularity !== null && k.popularity !== undefined
        ? `pop ${k.popularity}`
        : k.popularityEstimate?.tier
          ? `tier ${k.popularityEstimate.tier}`
          : "pop —";
      return `<li><code>${esc(k.query)}</code> — #${k.position} (${esc(pop)})</li>`;
    })
    .join("");

  const formats = item.paid?.formats
    ? Object.entries(item.paid.formats)
        .filter(([, v]) => v > 0)
        .map(([k, v]) => `${k}: ${v}`)
        .join(", ")
    : "—";

  const platforms = item.organic?.platforms
    ? Object.entries(item.organic.platforms)
        .map(([k, v]) => `${k} (${v})`)
        .join(", ")
    : "—";

  return `
    <tr class="detail-row">
      <td colspan="8">
        <div class="detail-grid">
          <div class="detail-box">
            <h4>Paid Ads (${esc(item.paidStatus?.freshness || "never")})</h4>
            <ul class="detail-list">
              <li>Live / Total: <strong>${item.paid ? `${fmtCompact(item.paid.liveAds)} / ${fmtCompact(item.paid.totalAds)}` : "—"}</strong></li>
              <li>Started last 7d: ${item.paid ? item.paid.startedLast7Days : "—"} · Median live: ${item.paid?.medianDaysLive ?? "—"}d</li>
              <li>Formats: ${esc(formats)}</li>
              <li>Web funnel share: ${item.paidMomentum?.webSharePct !== null && item.paidMomentum?.webSharePct !== undefined ? `${item.paidMomentum.webSharePct}%` : "—"}</li>
            </ul>
            ${barsHtml}
          </div>
          <div class="detail-box">
            <h4>Organic &amp; Estimates</h4>
            <ul class="detail-list">
              <li>Matched posts: <strong>${item.organic ? item.organic.matchedPosts : "—"}</strong> (${esc(platforms)})</li>
              <li>Views / Median: ${item.organic ? `${fmtCompact(item.organic.views)} / ${fmtCompact(item.organic.medianViews)}` : "—"}</li>
              <li>Est. installs (WW/mo): <strong>${esc(fmtEstimate(item.estimates?.monthlyInstalls, false))}</strong></li>
              <li>Est. App Store rev (WW/mo): ${esc(fmtEstimate(item.estimates?.monthlyRevenue, true))}</li>
            </ul>
          </div>
          <div class="detail-box">
            <h4>US ASO Top Keywords</h4>
            ${topKws ? `<ul class="detail-list">${topKws}</ul>` : `<div class="muted" style="font-size:12.5px;">No stored US keyword observations.</div>`}
          </div>
          <div class="detail-box">
            <h4>Chart Trajectory</h4>
            ${buildSparkline(item.history)}
            <div class="muted" style="font-size:12px;margin-top:6px;">
              Store ID: <code>${esc(item.storeId)}</code> · Rating: ${item.rating ?? "—"} (${fmtCompact(item.ratingCount)})
              ${item.appUrl ? ` · <a href="${esc(item.appUrl)}" target="_blank" rel="noopener">App Store</a>` : ""}
            </div>
          </div>
        </div>
      </td>
    </tr>
  `;
}

function getFilteredItems() {
  const items = state.report?.items || [];
  const q = state.search.trim().toLowerCase();

  const list = items.filter((item) => {
    if (state.driver !== "all" && item.driver !== state.driver) return false;
    if (!q) return true;
    const hay = [
      item.name,
      item.developer,
      item.storeId,
      item.keywords?.best?.query,
      ...(item.keywords?.top || []).map((k) => k.query),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  });

  list.sort((a, b) => {
    if (state.sort === "rank") return (a.rank ?? 9999) - (b.rank ?? 9999);
    if (state.sort === "liveAds") return (b.paid?.liveAds ?? -1) - (a.paid?.liveAds ?? -1);
    if (state.sort === "organicViews") return (b.organic?.views ?? -1) - (a.organic?.views ?? -1);
    if (state.sort === "keywords") return (b.keywords?.top10 ?? -1) - (a.keywords?.top10 ?? -1);
    return (b.movement ?? -9999) - (a.movement ?? -9999);
  });

  return list;
}

function renderTable() {
  const body = document.getElementById("results-body");
  const items = getFilteredItems();

  if (items.length === 0) {
    body.innerHTML = `<tr><td colspan="8" class="empty-cell">No apps match the current filter.</td></tr>`;
    return;
  }

  body.innerHTML = items
    .map((item) => {
      const moveText =
        item.status === "new_entrant" || item.status === "new-entrant"
          ? "NEW"
          : item.movement > 0
            ? `+${item.movement}`
            : item.movement ?? "—";
      const moveClass =
        moveText === "NEW"
          ? "move-new"
          : item.movement > 0
            ? "move-pos"
            : item.movement < 0
              ? "move-neg"
              : "muted";
      const iconHtml = item.iconUrl
        ? `<img class="app-icon" src="${esc(item.iconUrl)}" alt="" loading="lazy" />`
        : `<div class="app-icon"></div>`;

      const mainRow = `
        <tr class="data-row" data-id="${esc(item.storeId)}">
          <td class="num">#${item.rank ?? "—"}</td>
          <td class="num ${moveClass}">${esc(moveText)}</td>
          <td>
            <div class="app-cell">
              ${iconHtml}
              <div>
                <div class="app-name">${esc(item.name)}</div>
                <div class="app-dev">${esc(item.developer || item.storeId)}</div>
              </div>
            </div>
          </td>
          <td><span class="badge badge-${esc(item.driver)}">${esc(item.driverLabel)}</span></td>
          <td>${esc(fmtPaid(item))}</td>
          <td>${esc(fmtOrganic(item))}</td>
          <td>${esc(fmtKeywords(item))}</td>
          <td>${esc(fmtEstimate(item.estimates?.monthlyInstalls, false))}</td>
        </tr>
      `;

      return state.expandedId === item.storeId ? mainRow + buildDetailRow(item) : mainRow;
    })
    .join("");

  body.querySelectorAll("tr.data-row").forEach((tr) => {
    tr.addEventListener("click", () => {
      const id = tr.dataset.id;
      state.expandedId = state.expandedId === id ? null : id;
      renderTable();
    });
  });
}

function updateCliBuilder() {
  const country = document.getElementById("b-country").value;
  const category = document.getElementById("b-category").value;
  const chart = document.getElementById("b-chart").value;
  const view = document.getElementById("b-view").value;
  const format = document.getElementById("b-format").value;
  const savePart = format === "json" ? " > run.json" : "";
  const cmd = `node bin/chart-signals.mjs --country ${country} --category ${category} --chart ${chart} --view ${view} --limit 30 --format ${format}${savePart}`;
  document.getElementById("cli-command").textContent = cmd;
}

function renderAll() {
  renderMeta();
  renderKpis();
  renderDiffBanner();
  renderTable();
}

function wireEvents() {
  document.getElementById("search-input").addEventListener("input", (e) => {
    state.search = e.target.value;
    renderTable();
  });

  document.getElementById("driver-select").addEventListener("change", (e) => {
    state.driver = e.target.value;
    renderAll();
  });

  document.getElementById("sort-select").addEventListener("change", (e) => {
    state.sort = e.target.value;
    renderTable();
  });

  document.getElementById("json-upload").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (!Array.isArray(parsed.items)) throw new Error("Missing items array");
      state.report = parsed;
      state.expandedId = null;
      renderAll();
    } catch (err) {
      alert(`Invalid report JSON: ${err.message}`);
    }
  });

  document.getElementById("prev-upload").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (!Array.isArray(parsed.items)) throw new Error("Missing items array");
      state.prevReport = parsed;
      renderDiffBanner();
    } catch (err) {
      alert(`Invalid previous snapshot JSON: ${err.message}`);
    }
  });

  ["b-country", "b-category", "b-chart", "b-view", "b-format"].forEach((id) => {
    document.getElementById(id).addEventListener("change", updateCliBuilder);
  });

  document.getElementById("copy-cmd").addEventListener("click", async () => {
    const cmd = document.getElementById("cli-command").textContent;
    await navigator.clipboard.writeText(cmd);
    const btn = document.getElementById("copy-cmd");
    btn.textContent = "Copied";
    setTimeout(() => {
      btn.textContent = "Copy";
    }, 1200);
  });
}

async function init() {
  wireEvents();
  updateCliBuilder();
  try {
    const res = await fetch("./examples/run.json");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.report = await res.json();
    renderAll();
  } catch (err) {
    document.getElementById("results-body").innerHTML =
      `<tr><td colspan="8" class="empty-cell">Could not load sample run (${esc(err.message)}). Load any CLI JSON file above.</td></tr>`;
  }
}

init();
