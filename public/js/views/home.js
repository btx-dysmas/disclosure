// Dashboard: search, the newest filings on EDGAR, the watchlist and recently viewed companies.
import { api, date, esc, failure, loading, store, target } from "../lib.js";
import { titleCase } from "./company.js";

const EXAMPLES = ["AAPL", "MSFT", "NVDA", "BRK.B", "JPM", "Tesla"];
const FEEDS = [["10-K", "10-K"], ["10-Q", "10-Q"], ["8-K", "8-K"], ["S-1", "S-1"], ["DEF 14A", "Proxy"], ["SC 13D", "13D"]];

export async function render(root) {
  document.title = "Disclosure · SEC filing research";
  const recent = store.get("recent", []);
  const watch = store.get("watch", []);
  const feed = store.get("feed", "10-K");
  root.innerHTML = `
    <div class="home-top">
      <div>
        <h1 class="page-title">Company research from SEC filings</h1>
        <form class="home-search" id="home-q" autocomplete="off">
          <input name="q" placeholder="Ticker, company name or accession number" aria-label="Search" autofocus spellcheck="false">
          <button class="btn primary" style="height:38px">Open</button>
        </form>
        <div class="hint">Try ${EXAMPLES.map((e) => `<a href="#" data-q="${esc(e)}">${esc(e)}</a>`).join("")}· press <kbd>/</kbd> anywhere to search</div>
      </div>
    </div>
    <div class="cols wide-left">
      <section class="panel">
        <header><h2>Latest filings on EDGAR</h2><span class="sub">Updated every ten minutes</span>
          <div class="right"><span class="seg" id="feed">${FEEDS.map(([f, l]) => `<button data-f="${esc(f)}" class="${f === feed ? "on" : ""}">${esc(l)}</button>`).join("")}</span></div></header>
        <div id="latest">${loading("Loading the EDGAR feed")}</div>
      </section>
      <div>
        <section class="panel">
          <header><h2>Watchlist</h2><span class="sub">${watch.length ? `${watch.length} ${watch.length === 1 ? "company" : "companies"}` : ""}</span><div class="right"><a href="#/workspace">Workspace</a></div></header>
          ${watch.length ? `<table class="grid"><tbody>${watch.slice(0, 12).map((c) => `<tr class="link" data-go="#/c/${encodeURIComponent(c.ticker || c.cik)}"><td class="form">${esc(c.ticker || "—")}</td><td>${esc(titleCase(c.name))}</td><td class="r"><a href="#/c/${encodeURIComponent(c.ticker || c.cik)}/filings">Filings</a></td></tr>`).join("")}</tbody></table>`
            : `<div class="empty">Add companies with “Add to watchlist” on their page.</div>`}
        </section>
        <section class="panel">
          <header><h2>Recently viewed</h2></header>
          ${recent.length ? `<table class="grid"><tbody>${recent.map((c) => `<tr class="link" data-go="#/c/${encodeURIComponent(c.ticker || c.cik)}"><td class="form">${esc(c.ticker || "—")}</td><td>${esc(titleCase(c.name))}</td><td class="r mono muted">${c.cik}</td></tr>`).join("")}</tbody></table>`
            : `<div class="empty">Companies you open appear here.</div>`}
        </section>
        <section class="panel">
          <header><h2>On each company page</h2></header>
          <dl class="kv plain">
            <dt>Reader</dt><dd>Filings with section navigation and search</dd>
            <dt>Segments</dt><dd>Revenue and operating income by segment, from XBRL</dd>
            <dt>Financials</dt><dd>Ten years of statements, split-adjusted</dd>
            <dt>Risk factors</dt><dd>Added, removed and reworded risks by year</dd>
            <dt>Compare</dt><dd>Two filings side by side, section by section</dd>
            <dt>Insiders, ownership</dt><dd>Form 4 trades and 13F holders</dd>
          </dl>
        </section>
      </div>
    </div>`;

  const go = async (q) => {
    const r = (await api(`/search?q=${encodeURIComponent(q)}`).catch(() => []))[0];
    if (r) location.hash = target(r);
  };
  root.querySelector("#home-q").addEventListener("submit", (e) => { e.preventDefault(); const q = e.target.q.value.trim(); if (q) go(q); });
  root.querySelectorAll("[data-q]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); go(a.dataset.q); }));
  root.querySelectorAll("[data-go]").forEach((tr) => tr.addEventListener("click", (e) => { if (!e.target.closest("a")) location.hash = tr.dataset.go; }));

  const drawFeed = async (form) => {
    store.set("feed", form);
    root.querySelectorAll("#feed button").forEach((b) => b.classList.toggle("on", b.dataset.f === form));
    const el = root.querySelector("#latest");
    el.innerHTML = loading("Loading the EDGAR feed");
    try {
      const rows = await api(`/latest?form=${encodeURIComponent(form)}`);
      el.innerHTML = rows.length ? `<div class="scroll" style="max-height:640px"><table class="grid"><thead><tr><th>Form</th><th>Company</th><th class="r">CIK</th><th class="r">Accepted</th><th></th></tr></thead><tbody>
        ${rows.map((f) => `<tr><td class="form">${esc(f.form)}</td><td><a href="#/c/${f.cik}">${esc(titleCase(f.company))}</a></td><td class="r mono muted">${f.cik}</td>
          <td class="r">${esc((f.accepted || "").slice(0, 16).replace("T", " "))}</td><td class="r"><a href="#/c/${f.cik}/read/${f.accession}">Read</a></td></tr>`).join("")}
      </tbody></table></div>` : `<div class="empty">No recent ${esc(form)} filings.</div>`;
    } catch (e) { el.innerHTML = failure("EDGAR feed unavailable", e); }
  };
  root.querySelector("#feed").addEventListener("click", (e) => { if (e.target.dataset.f) drawFeed(e.target.dataset.f); });
  drawFeed(feed);
}
