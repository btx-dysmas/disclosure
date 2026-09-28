// Institutional ownership: positions of the largest 13F filers in this company, and how they changed last quarter.
import { api, chart, date, esc, failure, loading, money, num, ok, pct, tone } from "../lib.js";

const STATUS = { new: "New position", increased: "Increased", reduced: "Reduced", exited: "Sold out", unchanged: "Unchanged", noprior: "No prior report" };

export async function render(root, { co, key }) {
  const k = encodeURIComponent(key);
  root.innerHTML = loading("Looking up 13F positions");
  let d;
  try { d = await api(`/company/${k}/ownership`); } catch (e) { root.innerHTML = failure("Ownership data unavailable", e); return; }
  if (!d.available || !d.holders?.length) {
    root.innerHTML = `<section class="panel"><header><h2>Institutional ownership</h2></header><div class="empty">${esc(d.reason || "No data.")}</div></section>`;
    return;
  }
  const S = d.summary;
  root.innerHTML = `
    <div class="cols wide-right">
      <section class="panel">
        <header><h2>Summary</h2><span class="sub">${d.managers} tracked managers</span></header>
        <dl class="kv">
          <dt>Managers holding</dt><dd>${S.holders} of ${d.managers}</dd>
          <dt>Shares held</dt><dd>${num(S.shares)}</dd>
          <dt>Reported value</dt><dd>${money(S.value)}</dd>
          <dt>Net change in shares</dt><dd class="${tone(S.netChange)}">${S.netChange > 0 ? "+" : ""}${num(S.netChange)}</dd>
          <dt>Increased / new</dt><dd class="pos">${S.increased} / ${S.new}</dd>
          <dt>Reduced / sold out</dt><dd class="neg">${S.reduced} / ${S.exited}</dd>
          <dt>Share classes matched</dt><dd>${d.classes.map((c) => `${esc(c.class)} <span class="mono muted">${esc(c.cusip)}</span>`).join("<br>")}</dd>
        </dl>
        <div class="note">From each manager's latest 13F-HR (quarter ending ${d.periods.map(date).join(" or ")}) against the one before. 13F covers U.S.-listed equity held at quarter end; it is filed up to 45 days later and excludes short positions.</div>
      </section>
      <section class="panel">
        <header><h2>Change in shares last quarter</h2><span class="sub">Largest holders</span></header>
        <div style="padding:8px 8px 0"><div id="oc" style="height:${Math.max(260, Math.min(15, d.holders.length) * 24 + 40)}px"></div></div>
      </section>
    </div>
    <section class="panel">
      <header><h2>Holders</h2><span class="sub">Largest institutional managers by 13F assets</span></header>
      <div class="scroll"><table class="grid">
        <thead><tr><th>Manager</th><th class="r">Quarter</th><th class="r">Shares</th><th class="r">Value</th><th class="r">Change in shares</th><th class="r">Change</th><th>Action</th><th class="r">Share of manager's 13F</th><th></th></tr></thead>
        <tbody>${d.holders.map((h) => `<tr>
          <td>${esc(h.name)}</td><td class="r">${date(h.period).replace(/^\w+ \d+, /, (m) => m)}</td>
          <td class="r">${num(h.shares)}</td><td class="r">${money(h.value)}</td>
          <td class="r ${tone(h.change)}">${ok(h.change) ? `${h.change > 0 ? "+" : ""}${num(h.change)}` : "—"}</td><td class="r ${tone(h.changePct)}">${ok(h.changePct) ? pct(h.changePct, 1, true) : "—"}</td>
          <td class="${h.status === "new" || h.status === "increased" ? "pos" : h.status === "reduced" || h.status === "exited" ? "neg" : "muted"}">${STATUS[h.status]}</td>
          <td class="r">${pct(h.weight, 2)}</td><td><a href="#/c/${h.cik}/read/${h.accession}">13F</a></td></tr>`).join("")}</tbody>
      </table></div>
      <div class="note">Covers ${d.managers} of the largest 13F filers, which together hold a large share of most U.S. large caps; total institutional ownership would need all of the roughly 7,000 quarterly 13F filings. Positions under $2 million are not stored.</div>
    </section>`;

  const top = d.holders.filter((h) => ok(h.change)).slice(0, 15).reverse();
  chart(root.querySelector("#oc"), [{
    type: "bar", orientation: "h", y: top.map((h) => short(h.name)), x: top.map((h) => h.change / 1e6),
    marker: { color: top.map((h) => (h.change >= 0 ? "#1a7348" : "#a8281e")) }, hovertemplate: "%{y}: %{x:+,.2f}M shares<extra></extra>",
  }], { margin: { l: 170, t: 8, b: 36 }, xaxis: { ticksuffix: "M", zeroline: true, zerolinecolor: "#8a94a5" }, yaxis: { automargin: true }, showlegend: false });
}

// Manager names as filed are capitalized and carry legal suffixes; shorten them for the chart.
const short = (n) => {
  let s = n.replace(/\/[A-Z]{2}\//g, "").replace(/(INC|LLC|LP|LLP|CORP|CO|GROUP|MANAGEMENT|ASSOCIATES|PLC|AG|LTD|L\.P\.)\.?/gi, "").replace(/[,.&\s]+$/, "").replace(/\s+/g, " ").trim();
  if (s === s.toUpperCase()) s = s.toLowerCase().replace(/\w/g, (c) => c.toUpperCase());
  return s.slice(0, 28);
};
