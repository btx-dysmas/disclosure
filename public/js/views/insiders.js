// Insider trading: Form 4 purchases and sales, by month and by insider.
import { api, chart, css, date, esc, failure, loading, money, num, ok, store } from "../lib.js";

export async function render(root, { co, key }) {
  const k = encodeURIComponent(key);
  root.innerHTML = loading("Reading the most recent Form 4 filings (first load takes a few seconds)");
  let d;
  try { d = await api(`/company/${k}/insiders`); } catch (e) { root.innerHTML = failure("Insider filings unavailable", e); return; }
  if (!d.transactions.length) { root.innerHTML = `<section class="panel"><div class="empty">No Form 4 filings on record for this company.</div></section>`; return; }

  const open = d.transactions.filter((t) => t.kind === "common" && ["P", "S"].includes(t.code) && t.value);
  const buys = open.filter((t) => t.code === "P"), sells = open.filter((t) => t.code === "S");
  const sum = (xs) => xs.reduce((s, t) => s + t.value, 0);
  const plan = sells.filter((t) => t.plan);
  let only = store.get("ins:only", true);

  root.innerHTML = `
    <div class="cols wide-left">
      <section class="panel">
        <header><h2>Open-market activity by month</h2><span class="sub">${d.filings} most recent Form 4 filings, ${date(d.span[0])} to ${date(d.span[1])}</span></header>
        <div style="padding:8px 8px 0"><div id="mc" style="height:260px"></div></div>
      </section>
      <section class="panel">
        <header><h2>Summary</h2></header>
        <dl class="kv">
          <dt>Open-market purchases</dt><dd class="pos">${money(sum(buys))} · ${buys.length} trade${buys.length === 1 ? "" : "s"}</dd>
          <dt>Open-market sales</dt><dd class="neg">${money(sum(sells))} · ${sells.length} trade${sells.length === 1 ? "" : "s"}</dd>
          <dt>Net</dt><dd>${money(sum(buys) - sum(sells))}</dd>
          <dt>Sales under 10b5-1 plans</dt><dd>${sells.length ? `${Math.round((plan.length / sells.length) * 100)}% of sales` : "—"}</dd>
          <dt>Insiders trading</dt><dd>${d.insiders.length}</dd>
        </dl>
        <div class="note">Purchases with personal money are the signal analysts weigh most. Sales are routine for executives paid in stock, especially under a pre-arranged Rule 10b5-1 plan, which Form 4 has flagged since 2023.</div>
      </section>
    </div>
    <section class="panel">
      <header><h2>Insiders</h2><span class="sub">Open-market trades in this window</span></header>
      <div class="scroll"><table class="grid">
        <thead><tr><th>Name</th><th>Role</th><th class="r">Bought</th><th class="r">Sold</th><th class="r">Shares sold</th><th class="r">Plan sales</th><th class="r">Direct holding after</th><th class="r">Last filing</th></tr></thead>
        <tbody>${d.insiders.map((p) => `<tr><td>${esc(name(p.owner))}</td><td class="muted">${esc(p.role || "—")}</td>
          <td class="r ${p.bought ? "pos" : ""}">${p.bought ? money(p.bought) : "—"}</td><td class="r ${p.sold ? "neg" : ""}">${p.sold ? money(p.sold) : "—"}</td>
          <td class="r">${p.soldShares ? num(p.soldShares) : "—"}</td><td class="r">${p.plan || "—"}</td><td class="r">${ok(p.holding) ? num(p.holding) : "—"}</td><td class="r">${date(p.last)}</td></tr>`).join("")}</tbody>
      </table></div>
    </section>
    <section class="panel">
      <header><h2>Transactions</h2><div class="right"><label class="muted"><input type="checkbox" id="only"> Open-market trades only</label></div></header>
      <div class="scroll" style="max-height:560px"><table class="grid"><thead><tr><th>Date</th><th>Insider</th><th>Transaction</th><th>Security</th><th class="r">Shares</th><th class="r">Price</th><th class="r">Value</th><th class="r">Owned after</th><th>Plan</th><th>Filing</th></tr></thead><tbody id="tx"></tbody></table></div>
    </section>`;

  const drawTx = () => {
    store.set("ins:only", only);
    const rows = only ? open : d.transactions;
    root.querySelector("#tx").innerHTML = rows.slice(0, 400).map((t) => `<tr>
      <td class="r">${date(t.date)}</td><td>${esc(name(t.owner))}</td>
      <td class="${t.code === "P" ? "pos" : t.code === "S" ? "neg" : "muted"}">${esc(t.type)}${t.kind === "derivative" ? " (derivative)" : ""}</td>
      <td class="muted">${esc(t.security || "")}</td>
      <td class="r">${ok(t.shares) ? `${t.acquired ? "+" : "−"}${num(t.shares)}` : "—"}</td><td class="r">${ok(t.price) ? `$${t.price.toFixed(2)}` : "—"}</td>
      <td class="r">${ok(t.value) ? money(t.value) : "—"}</td><td class="r">${ok(t.after) ? num(t.after) : "—"}</td><td>${t.plan ? "10b5-1" : ""}</td>
      <td><a href="#/c/${k}/read/${t.accession}">Form 4</a></td></tr>`).join("") || `<tr><td colspan="10" class="empty">No open-market trades in this window.</td></tr>`;
  };
  const cb = root.querySelector("#only");
  cb.checked = only;
  cb.addEventListener("change", () => { only = cb.checked; drawTx(); });
  drawTx();

  const M = d.months;
  chart(root.querySelector("#mc"), [
    { type: "bar", name: "Purchases", x: M.map((m) => m.month), y: M.map((m) => m.buys / 1e6), marker: { color: css("--pos") }, hovertemplate: "%{x}: $%{y:,.1f}M bought<extra></extra>" },
    { type: "bar", name: "Sales", x: M.map((m) => m.month), y: M.map((m) => -m.sells / 1e6), marker: { color: css("--neg") }, hovertemplate: "%{x}: $%{customdata:,.1f}M sold<extra></extra>", customdata: M.map((m) => m.sells / 1e6) },
  ], { barmode: "relative", yaxis: { ticksuffix: "M", title: { text: "$ millions", font: { size: 11 } } }, xaxis: { type: "category" } });
}

// Form 4 lists people as "Last First Middle". Put the first name first, and leave entities alone.
const ENTITY = /\b(inc|llc|l\.?p|ltd|corp|co|trust|fund|holdings?|capital|partners|management|group|foundation|plc|n\.?a)\b\.?$/i;
function name(s) {
  const parts = s.trim().split(/\s+/);
  if (parts.length < 2 || parts.length > 4 || ENTITY.test(s)) return s;
  const cap = (w) => (w === w.toUpperCase() && w.length > 2 ? w.charAt(0) + w.slice(1).toLowerCase() : w);
  const suffix = /^(jr|sr|ii|iii|iv)\.?$/i.test(parts[parts.length - 1]) ? parts.pop() : null;
  return [...parts.slice(1), parts[0], ...(suffix ? [suffix] : [])].map(cap).join(" ");
}
