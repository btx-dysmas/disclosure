// Workspace: the watchlist, kept in this browser.
import { esc, store } from "../lib.js";

export async function render(root) {
  const watch = store.get("watch", []);
  root.innerHTML = `
    <h1 class="page-title">Workspace</h1>
    <section class="panel">
      <header><h2>Watchlist</h2><span class="sub">${watch.length} ${watch.length === 1 ? "company" : "companies"} · stored in this browser</span></header>
      ${watch.length ? `<table class="grid"><thead><tr><th>Ticker</th><th>Company</th><th class="r">Added</th></tr></thead><tbody>
        ${watch.map((c) => `<tr><td class="form"><a href="#/c/${encodeURIComponent(c.ticker || c.cik)}">${esc(c.ticker || c.cik)}</a></td><td>${esc(c.name)}</td><td class="r">${esc(c.added || "")}</td></tr>`).join("")}
      </tbody></table>` : `<div class="empty">Add companies from their page with “Add to watchlist”.</div>`}
    </section>`;
}
