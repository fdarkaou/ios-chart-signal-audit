export const DEFAULT_BASE_URL = "https://api.peekpanda.com";

export const STOREFRONTS = [
  { code: "us", name: "United States" },
  { code: "gb", name: "United Kingdom" },
  { code: "fr", name: "France" },
  { code: "de", name: "Germany" },
  { code: "br", name: "Brazil" },
  { code: "be", name: "Belgium" },
  { code: "jp", name: "Japan" },
  { code: "kr", name: "South Korea" },
  { code: "cn", name: "China" },
  { code: "ru", name: "Russia" },
];

export const VALID_COUNTRIES = new Set(STOREFRONTS.map((s) => s.code));
export const VALID_CHARTS = new Set(["free", "paid", "grossing"]);
export const VALID_VIEWS = new Set([
  "rankings",
  "gainers",
  "losers",
  "new-entrants",
  "new-releases",
]);

export const CATEGORY_ALIASES = {
  all: "all",
  overall: "all",
  books: "6018",
  business: "6000",
  catalogs: "6022",
  "developer-tools": "6026",
  education: "6017",
  entertainment: "6016",
  finance: "6015",
  "food-and-drink": "6023",
  food: "6023",
  games: "6014",
  "graphics-and-design": "6027",
  "health-and-fitness": "6013",
  health: "6013",
  fitness: "6013",
  lifestyle: "6012",
  "magazines-and-newspapers": "6021",
  medical: "6020",
  music: "6011",
  navigation: "6010",
  news: "6009",
  "photo-and-video": "6008",
  photo: "6008",
  productivity: "6007",
  reference: "6006",
  shopping: "6024",
  "social-networking": "6005",
  social: "6005",
  sports: "6004",
  stickers: "6025",
  travel: "6003",
  utilities: "6002",
  weather: "6001",
};

export const DRIVER_LABELS = {
  "multi-channel": "Multi-channel",
  "paid-push": "Paid-ad push",
  "organic-surge": "Organic surge",
  "aso-moat": "ASO search moat",
  uncollected: "Uncollected",
  unexplained: "Unexplained move",
};

export const VALID_DRIVERS = new Set(Object.keys(DRIVER_LABELS));

export function resolveCategoryId(input) {
  if (!input) return "all";
  const raw = String(input).trim().toLowerCase();
  if (raw === "all" || /^\d+$/.test(raw)) return raw;
  const normalized = raw
    .replace(/&/g, " and ")
    .replace(/[_\s]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (CATEGORY_ALIASES[normalized]) return CATEGORY_ALIASES[normalized];
  throw new Error(
    `Unknown category "${input}". Pass "all", a numeric Apple category ID (e.g. 6013), or a slug like health-and-fitness, productivity, finance.`,
  );
}
