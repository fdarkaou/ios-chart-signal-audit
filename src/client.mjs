import { DEFAULT_BASE_URL } from "./constants.mjs";

const MAX_RETRIES = 2;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfterMs(headerValue) {
  if (!headerValue) return 1500;
  const seconds = Number(headerValue);
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.min(seconds * 1000, 15000);
  }
  const dateMs = Date.parse(headerValue);
  if (Number.isFinite(dateMs)) {
    return Math.min(Math.max(dateMs - Date.now(), 500), 15000);
  }
  return 1500;
}

export async function apiGet(path, params, { apiKey, baseUrl = DEFAULT_BASE_URL, tenancy, fetchImpl = fetch } = {}) {
  if (!apiKey) {
    throw new Error("Missing PeekPanda API key. Set PEEKPANDA_API_KEY or pass --api-key-file.");
  }

  const url = new URL(path, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  for (const [key, value] of Object.entries(params || {})) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    Accept: "application/json",
    "User-Agent": "ios-chart-signal-audit/1.0.0",
  };
  if (tenancy) {
    headers["x-genviral-tenancy"] = tenancy;
  }

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    const res = await fetchImpl(url.toString(), { method: "GET", headers });
    const text = await res.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = null;
    }

    if (res.ok) {
      return payload;
    }

    const code = payload?.error?.code || `http_${res.status}`;
    const message = payload?.error?.message || text.slice(0, 200) || `HTTP ${res.status}`;

    if (res.status === 429 && code !== "daily_call_limit" && attempt < MAX_RETRIES) {
      const waitMs = parseRetryAfterMs(res.headers.get("retry-after"));
      await sleep(waitMs);
      continue;
    }

    const err = new Error(`PeekPanda API ${res.status} (${code}): ${message}`);
    err.status = res.status;
    err.code = code;
    throw err;
  }

  throw new Error("PeekPanda API request failed after retries.");
}

export async function fetchChartWithSignals(
  { country = "us", categoryId = "all", chartType = "free", view = "gainers", limit = 50 },
  clientOptions,
) {
  const chart = await apiGet(
    "/v1/charts",
    { country, categoryId, chartType, view, limit },
    clientOptions,
  );

  const rows = Array.isArray(chart?.data) ? chart.data : [];
  const storeIds = [...new Set(rows.map((r) => String(r.storeId)).filter((id) => /^\d+$/.test(id)))];

  if (storeIds.length === 0) {
    return {
      chart,
      signals: {
        country,
        weeks: [],
        keywordsObservedAt: null,
        organicViewsCountedAt: null,
        apps: [],
      },
      apiCalls: 1,
    };
  }

  // GET /v1/market/signals accepts up to 600 unique store IDs in one batch.
  const signals = await apiGet(
    "/v1/market/signals",
    { country, storeIds: storeIds.join(",") },
    clientOptions,
  );

  return { chart, signals, apiCalls: 2 };
}
