// Shared helpers: API access, escaping, number and date formatting, local storage, market hours.

const inflight = new Map();

/** GET a JSON endpoint under /api. Identical concurrent requests share one fetch. */
export function api(path) {
  if (inflight.has(path)) return inflight.get(path);
  const p = fetch(`/api${path}`).then(async (r) => {
    let body = null;
    try { body = await r.json(); } catch { /* not JSON */ }
    if (!r.ok) throw new Error(body?.detail || `Request failed (HTTP ${r.status})`);
    return body;
  });
  inflight.set(path, p);
  p.then(() => setTimeout(() => inflight.delete(path), 60_000), () => inflight.delete(path));
  return p;
}

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** Where a search result opens: the company, or the filing itself for an accession number. */
export function target(r) {
  const key = encodeURIComponent(r.ticker || r.cik);
  return r.kind === "filing" ? `#/c/${key}/read/${r.accession}` : `#/c/${key}`;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function date(iso) {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}
export const monthYear = (iso) => (iso ? `${MONTHS[+iso.slice(5, 7) - 1]} ${iso.slice(0, 4)}` : "—");

export const ok = (v) => typeof v === "number" && Number.isFinite(v);

/** Dollar amounts at a readable scale: $1.23B, $456.7M, $12.3K. */
export function money(v, dp = 1) {
  if (!ok(v)) return "—";
  const a = Math.abs(v), s = v < 0 ? "-" : "";
  if (a >= 1e12) return `${s}$${(a / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(dp + 1)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(dp)}M`;
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(dp)}K`;
  return `${s}$${a.toFixed(0)}`;
}

/** Millions with separators, as financial statements print them. Negatives in parentheses. */
export function mil(v, dp = 0) {
  if (!ok(v)) return "—";
  const s = Math.abs(v / 1e6).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
  return v < 0 ? `(${s})` : s;
}

export function pct(v, dp = 1, sign = false) {
  if (!ok(v)) return "—";
  return `${sign && v > 0 ? "+" : ""}${(v * 100).toFixed(dp)}%`;
}

export const num = (v, dp = 0) => (ok(v) ? v.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp }) : "—");
export const tone = (v) => (ok(v) ? (v > 0 ? "pos" : v < 0 ? "neg" : "") : "");

export function bytes(n) {
  if (!ok(n)) return "—";
  return n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`;
}

/** Local storage that never throws (private windows and blocked storage return the fallback). */
export const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem(`disclosure:${key}`); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(`disclosure:${key}`, JSON.stringify(value)); } catch { /* storage unavailable */ }
  },
};

export function remember(company) {
  const list = store.get("recent", []).filter((c) => c.cik !== company.cik);
  list.unshift({ cik: company.cik, ticker: company.ticker, name: company.name });
  store.set("recent", list.slice(0, 8));
}

// NYSE and Nasdaq share a calendar. Full closures and 1:00 p.m. early closes, 2025 to 2027.
const HOLIDAYS = new Set([
  "2025-01-01", "2025-01-09", "2025-01-20", "2025-02-17", "2025-04-18", "2025-05-26", "2025-06-19", "2025-07-04", "2025-09-01", "2025-11-27", "2025-12-25",
  "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
  "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31", "2027-06-18", "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24",
]);
const EARLY = new Set(["2025-07-03", "2025-11-28", "2025-12-24", "2026-11-27", "2026-12-24", "2027-11-26"]);

function eastern(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" }).formatToParts(d).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, mins: +p.hour * 60 + +p.minute, weekday: p.weekday };
}

/** U.S. equity market session right now, in Eastern time. */
export function marketStatus(now = new Date()) {
  const { day, mins, weekday } = eastern(now);
  const tradingDay = !["Sat", "Sun"].includes(weekday) && !HOLIDAYS.has(day);
  const close = EARLY.has(day) ? 13 * 60 : 16 * 60;
  if (tradingDay && mins >= 9 * 60 + 30 && mins < close) return { open: true, label: `Market open · closes ${EARLY.has(day) ? "1:00" : "4:00"} p.m. ET` };
  if (tradingDay && mins >= 4 * 60 && mins < 9 * 60 + 30) return { open: false, label: "Pre-market · opens 9:30 a.m. ET" };
  if (tradingDay && mins >= close && mins < 20 * 60) return { open: false, label: "After hours · market closed" };
  if (HOLIDAYS.has(day)) return { open: false, label: "Market holiday · closed" };
  return { open: false, label: "Market closed" };
}

/** Load Plotly once, on the first page that draws a chart. */
let plotly = null;
export function loadPlotly() {
  if (!plotly) {
    plotly = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/plotly.js-dist-min@3.1.0/plotly.min.js";
      s.onload = () => resolve(window.Plotly);
      s.onerror = () => { plotly = null; reject(new Error("Chart library failed to load")); };
      document.head.appendChild(s);
    });
  }
  return plotly;
}

// Chart colors: muted, distinguishable, and legible on white.
export const PALETTE = ["#1f3a66", "#5b86b8", "#2f7d6d", "#b7832f", "#8e5a9c", "#9fbad8", "#7fb3a5", "#c46a5a", "#6b7380", "#d4b16a"];

/** Draw a Plotly chart with the house style. */
export async function chart(el, data, layout = {}) {
  const Plotly = await loadPlotly();
  const base = {
    font: { family: "Public Sans, Segoe UI, sans-serif", size: 12, color: "#454c57" },
    paper_bgcolor: "#fff", plot_bgcolor: "#fff",
    margin: { l: 56, r: 16, t: 12, b: 40 },
    xaxis: { gridcolor: "#eef0f3", linecolor: "#c9ced6", tickcolor: "#c9ced6", zeroline: false, automargin: true },
    yaxis: { gridcolor: "#eef0f3", linecolor: "#c9ced6", zerolinecolor: "#c9ced6", automargin: true },
    legend: { orientation: "h", y: -0.18, x: 0, font: { size: 12 } },
    hoverlabel: { font: { family: "Public Sans, sans-serif", size: 12 }, bgcolor: "#fff", bordercolor: "#c9ced6" },
    colorway: PALETTE,
    bargap: 0.28,
  };
  const merged = { ...base, ...layout, xaxis: { ...base.xaxis, ...layout.xaxis }, yaxis: { ...base.yaxis, ...layout.yaxis }, margin: { ...base.margin, ...layout.margin } };
  await Plotly.react(el, data, merged, { displayModeBar: false, responsive: true });
}

export function loading(text = "Loading") {
  return `<div class="loading">${esc(text)}…</div>`;
}

export function failure(title, err) {
  return `<div class="failure"><b>${esc(title)}</b><span>${esc(err?.message ?? err)}</span></div>`;
}
