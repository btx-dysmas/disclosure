// Company page: header, tab strip, and the selected tab.
import { api, date, esc, failure, loading, remember, store } from "../lib.js";

export const TABS = [
  ["filings", "Filings", () => import("./filings.js")],
  ["read", "Reader", () => import("./reader.js")],
  ["segments", "Segments", () => import("./segments.js")],
];

const MONTH = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const fye = (s) => (s && s.length === 4 ? `${MONTH[+s.slice(0, 2) - 1]} ${+s.slice(2)}` : "—");

let shown = null; // header already on screen for this company

export async function render(root, { key, tab, arg }) {
  if (!TABS.some((t) => t[0] === tab)) tab = TABS[0][0];
  if (shown?.key !== key) {
    root.innerHTML = loading("Loading company");
    let co;
    try { co = await api(`/company/${encodeURIComponent(key)}`); } catch (e) { root.innerHTML = failure("Company not found", e); shown = null; return; }
    shown = { key, co };
    remember({ cik: co.cik, ticker: co.tickers[0], name: co.name });
    document.title = `${co.tickers[0] || co.name} · Disclosure`;
    root.innerHTML = `${header(co)}<nav class="tabs" id="tabs"></nav><div id="tab"></div>`;
    wireHeader(root, co);
  }
  const { co } = shown;
  root.querySelector("#tabs").innerHTML = TABS.map(([k, label]) => `<a href="#/c/${encodeURIComponent(key)}/${k}" class="${k === tab ? "on" : ""}">${label}</a>`).join("");
  const pane = root.querySelector("#tab");
  pane.innerHTML = loading("Loading");
  const mod = await TABS.find((t) => t[0] === tab)[2]();
  if (shown?.key !== key) return;
  try {
    await mod.render(pane, { co, key, arg });
  } catch (e) {
    pane.innerHTML = failure("This view could not be built", e);
  }
}

// Leaving the company pages resets the header cache.
window.addEventListener("hashchange", () => { if (!location.hash.startsWith("#/c/")) shown = null; });

function header(co) {
  const tk = co.tickers.length ? co.tickers.join(", ") : "No listed ticker";
  const last = co.latestReport;
  return `
    <div class="co">
      <h1>${esc(titleCase(co.name))}</h1>
      <span class="tk">${esc(tk)}${co.exchanges.length ? ` · ${esc(co.exchanges[0])}` : ""}</span>
      <div class="actions"><button class="btn" id="watch"></button></div>
      <div class="facts">
        <span><b>CIK</b><span class="mono">${String(co.cik).padStart(10, "0")}</span></span>
        <span><b>Industry</b>${esc(co.sicDescription || "—")}${co.sic ? ` (SIC ${esc(co.sic)})` : ""}</span>
        <span><b>Fiscal year ends</b>${fye(co.fiscalYearEnd)}</span>
        <span><b>Incorporated</b>${esc(co.stateOfIncorporation || "—")}</span>
        <span><b>Filer status</b>${esc(co.category || "—")}</span>
        <span><b>Latest report</b>${last ? `${esc(last.form)} filed ${date(last.date)}` : "—"}</span>
        <span><b>Latest filing</b>${co.latestFiling ? `${esc(co.latestFiling.form)}, ${date(co.latestFiling.date)}` : "—"}</span>
      </div>
    </div>`;
}

function wireHeader(root, co) {
  const btn = root.querySelector("#watch");
  const draw = () => {
    const on = store.get("watch", []).some((c) => c.cik === co.cik);
    btn.textContent = on ? "On watchlist" : "Add to watchlist";
    btn.classList.toggle("primary", on);
  };
  btn.addEventListener("click", () => {
    const list = store.get("watch", []);
    const i = list.findIndex((c) => c.cik === co.cik);
    if (i >= 0) list.splice(i, 1);
    else list.unshift({ cik: co.cik, ticker: co.tickers[0], name: co.name, added: new Date().toISOString().slice(0, 10) });
    store.set("watch", list);
    draw();
  });
  draw();
}

/** EDGAR stores many names in capitals; show them the way the company writes them where it is safe to guess. */
export function titleCase(name) {
  if (!name || name !== name.toUpperCase()) return name;
  const keep = new Set(["LLC", "LP", "PLC", "NV", "SA", "AG", "USA", "II", "III", "IV", "REIT", "ETF", "AB", "SE", "ASA"]);
  return name.toLowerCase().replace(/\b[\w']+/g, (w) => (keep.has(w.toUpperCase()) ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1))).replace(/\bAnd\b/g, "and").replace(/\bOf\b/g, "of").replace(/ Corp$/, " Corp.").replace(/ Inc$/, " Inc.").replace(/ Co$/, " Co.");
}
