// Segment revenue explorer: revenue, growth, operating income and contribution by segment, product line and region.
import { api, chart, date, esc, failure, loading, mil, ok, PALETTE, pct, store, tone } from "../lib.js";

const fy = (end) => `FY${end.slice(0, 4)}`;
const growth = (a, b) => (ok(a) && ok(b) && b > 0 ? a / b - 1 : null);
const cagr = (a, b, n) => (ok(a) && ok(b) && a > 0 && b > 0 && n > 0 ? (a / b) ** (1 / n) - 1 : null);

export async function render(root, { co, key }) {
  root.innerHTML = loading("Reading segment disclosures from the last three 10-K XBRL filings");
  let d;
  try { d = await api(`/company/${encodeURIComponent(key)}/segments`); } catch (e) { root.innerHTML = failure("Segment data unavailable", e); return; }
  if (!d.breakdowns.length) {
    root.innerHTML = `<section class="panel"><header><h2>Segments</h2></header><div class="empty">${esc(d.reason || "No segment disclosures found.")} Companies with a single reportable segment often report no breakdown at all.</div></section>`;
    return;
  }
  let sel = store.get(`seg:${co.cik}`, d.breakdowns[0].key);
  if (!d.breakdowns.some((b) => b.key === sel)) sel = d.breakdowns[0].key;

  root.innerHTML = `
    <section class="panel">
      <header><h2>Segment revenue</h2><span class="sub">From XBRL in ${d.filings.length} annual report${d.filings.length > 1 ? "s" : ""}, latest filed ${date(d.filings[0].filed)}</span>
        <div class="right"><span class="seg" id="pick">${d.breakdowns.map((b) => `<button data-k="${b.key}">${esc(b.title)}</button>`).join("")}</span></div></header>
      <div id="body"></div>
    </section>`;
  const pick = root.querySelector("#pick");
  const draw = () => {
    pick.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.k === sel));
    store.set(`seg:${co.cik}`, sel);
    view(root.querySelector("#body"), d.breakdowns.find((b) => b.key === sel), d, key);
  };
  pick.addEventListener("click", (e) => { if (e.target.dataset.k) { sel = e.target.dataset.k; draw(); } });
  draw();
}

function view(el, b, d, key) {
  const n = b.years.length, L = n - 1;
  const top = b.rows.filter((r) => !r.parent);
  const overlap = b.coverage.some((c) => ok(c) && c > 1.03);
  const hasOI = b.rows.some((r) => r.operatingIncome?.some(ok));
  const oiTotal = hasOI ? top.reduce((s, r) => s + (r.operatingIncome?.[L] ?? 0), 0) : null;

  const rows = b.rows.map((r) => {
    const rev = r.revenue, oi = r.operatingIncome;
    return {
      ...r,
      yoy: growth(rev[L], rev[L - 1]),
      cagr: cagr(rev[L], rev[0], n - 1),
      share: ok(rev[L]) && ok(b.total[L]) ? rev[L] / b.total[L] : null,
      margin: oi && ok(oi[L]) && ok(rev[L]) && rev[L] ? oi[L] / rev[L] : null,
      oiShare: oi && ok(oi[L]) && oiTotal ? oi[L] / oiTotal : null,
    };
  });

  el.innerHTML = `
    ${overlap ? `<div class="note" style="border-top:0; border-bottom:1px solid var(--line-2)">This company tags subtotals and their components on the same axis in a way that could not be separated, so the lines below overlap and their shares add up to more than 100%. Figures are as filed.</div>` : ""}
    <div class="cols c2" style="padding:12px 14px 0">
      <div><div class="chart-title">Revenue by ${b.axis === "geography" ? "region" : b.axis === "product" ? "product line" : "segment"}, $ billions</div><div id="c1" style="height:300px"></div></div>
      <div><div class="chart-title">${hasOI ? "Operating margin" : "Year-over-year revenue growth"}</div><div id="c2" style="height:300px"></div></div>
    </div>
    <div class="scroll"><table class="grid">
      <thead>
        <tr><th rowspan="2">${b.axis === "geography" ? "Region" : b.axis === "product" ? "Product line" : "Segment"}</th><th colspan="${n}" class="c">Revenue, $ millions</th><th colspan="3" class="c">Growth and contribution</th>${hasOI ? `<th colspan="3" class="c">Operating income, ${fy(b.years[L])}</th>` : ""}</tr>
        <tr>${b.years.map((y) => `<th class="r">${fy(y)}</th>`).join("")}<th class="r">YoY</th><th class="r">${n - 1}-yr CAGR</th><th class="r">Share of revenue</th>${hasOI ? `<th class="r">$ millions</th><th class="r">Margin</th><th class="r">Share of total</th>` : ""}</tr>
      </thead>
      <tbody>
        ${rows.map((r) => `
          <tr class="${r.parent ? "sub" : ""}">
            <td>${esc(r.label)}</td>
            ${r.revenue.map((v) => `<td class="r">${mil(v)}</td>`).join("")}
            <td class="r ${tone(r.yoy)}">${pct(r.yoy, 1, true)}</td>
            <td class="r ${tone(r.cagr)}">${pct(r.cagr, 1, true)}</td>
            <td class="r">${overlap ? "—" : pct(r.share)}</td>
            ${hasOI ? `<td class="r">${r.operatingIncome ? mil(r.operatingIncome[L]) : "—"}</td><td class="r">${pct(r.margin)}</td><td class="r">${r.parent ? "" : pct(r.oiShare)}</td>` : ""}
          </tr>`).join("")}
        <tr class="total">
          <td>Consolidated revenue</td>${b.total.map((v) => `<td class="r">${mil(v)}</td>`).join("")}
          <td class="r ${tone(growth(b.total[L], b.total[L - 1]))}">${pct(growth(b.total[L], b.total[L - 1]), 1, true)}</td>
          <td class="r ${tone(cagr(b.total[L], b.total[0], n - 1))}">${pct(cagr(b.total[L], b.total[0], n - 1), 1, true)}</td><td class="r">100.0%</td>
          ${hasOI ? `<td class="r">${mil(oiTotal)}</td><td class="r">${pct(ok(oiTotal) && b.total[L] ? oiTotal / b.total[L] : null)}</td><td class="r"></td>` : ""}
        </tr>
        <tr><td class="muted">Segments as a share of consolidated</td>${b.coverage.map((c) => `<td class="r muted">${pct(c)}</td>`).join("")}<td colspan="${3 + (hasOI ? 3 : 0)}"></td></tr>
      </tbody>
    </table></div>
    <div class="note">
      ${b.restated ? `The company changed how it reports this breakdown; earlier years were filed under the old structure and are not mixed in. ` : ""}XBRL concept <code>${esc(b.concept)}</code>${b.operatingConcept ? ` and <code>${esc(b.operatingConcept)}</code>` : ""}, full fiscal years only. Where a later 10-K recasts earlier years, the recast figures are used.
      Segment operating income excludes corporate costs and eliminations, so segment totals can differ from consolidated operating income.
      Sources: ${d.filings.map((f) => `<a href="#/c/${encodeURIComponent(key)}/read/${f.accession}?note=segment">10-K filed ${date(f.filed)}</a>`).join(", ")}.
    </div>`;

  const x = b.years.map(fy);
  const shown = top.slice(0, 9);
  chart(el.querySelector("#c1"), shown.map((r, i) => ({
    type: "bar", name: r.label, x, y: r.revenue.map((v) => (ok(v) ? v / 1e9 : null)), marker: { color: PALETTE[i % PALETTE.length] },
    hovertemplate: `${esc(r.label)}<br>%{x}: $%{y:,.1f}B<extra></extra>`,
  })), { barmode: overlap ? "group" : "stack", yaxis: { tickprefix: "$", ticksuffix: "B" }, showlegend: true, legend: { orientation: "h", y: -0.18, x: 0, traceorder: "normal" } });

  if (hasOI) {
    chart(el.querySelector("#c2"), rows.filter((r) => !r.parent && r.operatingIncome).slice(0, 9).map((r, i) => ({
      type: "scatter", mode: "lines+markers", name: r.label, x,
      y: r.revenue.map((v, k) => (ok(v) && v && ok(r.operatingIncome[k]) ? (r.operatingIncome[k] / v) * 100 : null)),
      line: { color: PALETTE[top.indexOf(top.find((t) => t.member === r.member)) % PALETTE.length], width: 2 }, marker: { size: 6 },
      hovertemplate: `${esc(r.label)}<br>%{x}: %{y:.1f}%<extra></extra>`,
    })), { yaxis: { ticksuffix: "%" } });
  } else {
    chart(el.querySelector("#c2"), shown.map((r, i) => ({
      type: "bar", name: r.label, x: x.slice(1),
      y: r.revenue.slice(1).map((v, k) => { const g = growth(v, r.revenue[k]); return ok(g) ? g * 100 : null; }),
      marker: { color: PALETTE[i % PALETTE.length] }, hovertemplate: `${esc(r.label)}<br>%{x}: %{y:+.1f}%<extra></extra>`,
    })), { barmode: "group", yaxis: { ticksuffix: "%" } });
  }
}
