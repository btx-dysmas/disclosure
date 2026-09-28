// Dashboard: search, recently viewed companies and a few places to start.
import { api, esc, store, target } from "../lib.js";

const EXAMPLES = ["AAPL", "MSFT", "NVDA", "BRK.B", "JPM", "Tesla"];

export async function render(root) {
  const recent = store.get("recent", []);
  root.innerHTML = `
    <h1 class="page-title">Company research from SEC filings</h1>
    <form class="home-search" id="home-q" autocomplete="off">
      <input name="q" placeholder="Ticker, company name or accession number" aria-label="Search" autofocus spellcheck="false">
      <button class="btn primary" style="height:38px">Open</button>
    </form>
    <div class="hint">Try ${EXAMPLES.map((e) => `<a href="#" data-q="${esc(e)}">${esc(e)}</a>`).join("")}· press <kbd>/</kbd> anywhere to search</div>
    <div class="cols wide-left">
      <section class="panel">
        <header><h2>Recently viewed</h2><span class="sub">Stored in this browser</span></header>
        ${recent.length ? `<table class="grid"><thead><tr><th>Ticker</th><th>Company</th><th class="r">CIK</th></tr></thead><tbody>
          ${recent.map((c) => `<tr class="link" data-go="#/c/${encodeURIComponent(c.ticker || c.cik)}"><td class="form">${esc(c.ticker || "—")}</td><td>${esc(c.name)}</td><td class="r mono">${c.cik}</td></tr>`).join("")}
        </tbody></table>` : `<div class="empty">Companies you open appear here.</div>`}
      </section>
      <section class="panel">
        <header><h2>What you can do here</h2></header>
        <dl class="kv">
          <dt>Filing library</dt><dd>Every 10-K, 10-Q, 8-K, proxy and Form 4</dd>
        </dl>
      </section>
    </div>`;

  const go = async (q) => {
    const r = (await api(`/search?q=${encodeURIComponent(q)}`).catch(() => []))[0];
    if (r) location.hash = target(r);
  };
  root.querySelector("#home-q").addEventListener("submit", (e) => { e.preventDefault(); const q = e.target.q.value.trim(); if (q) go(q); });
  root.querySelectorAll("[data-q]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); go(a.dataset.q); }));
  root.querySelectorAll("[data-go]").forEach((tr) => tr.addEventListener("click", () => (location.hash = tr.dataset.go)));
}
