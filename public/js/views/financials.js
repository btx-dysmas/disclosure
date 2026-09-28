// Financial statement explorer: income statement, balance sheet and cash flow, annual or quarterly.
import { api, chart, esc, failure, loading, mil, num, ok, PALETTE, pct, store, tone } from "../lib.js";

const STMTS = [["income", "Income statement"], ["balance", "Balance sheet"], ["cash", "Cash flow"], ["ratios", "Ratios"]];
const RATIOS = [
  ["Gross margin", (l, i) => div(l.grossProfit[i], l.revenue[i])],
  ["Operating margin", (l, i) => div(l.operatingIncome[i], l.revenue[i])],
  ["EBITDA margin", (l, i) => div(l.ebitda[i], l.revenue[i])],
  ["Net margin", (l, i) => div(l.netIncome[i], l.revenue[i])],
  ["Free cash flow margin", (l, i) => div(l.fcf[i], l.revenue[i])],
  ["Free cash flow / net income", (l, i) => div(l.fcf[i], l.netIncome[i]), "x"],
  ["Return on equity", (l, i) => div(l.netIncome[i], avg(l.equity, i))],
  ["Return on assets", (l, i) => div(l.netIncome[i], avg(l.totalAssets, i))],
  ["R&D / revenue", (l, i) => div(l.rnd[i], l.revenue[i])],
  ["Stock comp / revenue", (l, i) => div(l.sbc[i], l.revenue[i])],
  ["Capex / revenue", (l, i) => div(l.capex[i], l.revenue[i])],
  ["Effective tax rate", (l, i) => div(l.incomeTax[i], l.pretaxIncome[i])],
  ["Current ratio", (l, i) => div(l.currentAssets[i], l.currentLiabilities[i]), "x"],
  ["Debt / equity", (l, i) => div(l.totalDebt[i], l.equity[i]), "x"],
  ["Net debt / EBITDA", (l, i) => div(l.netDebt[i], l.ebitda[i]), "x"],
  ["Interest coverage", (l, i) => div(l.operatingIncome[i], l.interestExpense[i]), "x"],
];
function div(a, b) { return ok(a) && ok(b) && b !== 0 ? a / b : null; }
function avg(arr, i) { return ok(arr[i]) && ok(arr[i - 1]) ? (arr[i] + arr[i - 1]) / 2 : arr[i]; }

export async function render(root, { co, key }) {
  root.innerHTML = loading("Loading XBRL company facts");
  let d;
  try { d = await api(`/company/${encodeURIComponent(key)}/financials`); } catch (e) { root.innerHTML = failure("Financial data unavailable", e); return; }
  if (!d.annual.periods.length) { root.innerHTML = `<section class="panel"><div class="empty">No US-GAAP financial statements in this company's XBRL filings. Foreign issuers reporting under IFRS and funds are not covered.</div></section>`; return; }

  const st = { stmt: store.get("fin:stmt", "income"), freq: store.get("fin:freq", "annual"), picked: store.get("fin:picked", ["revenue", "netIncome", "fcf"]) };
  root.innerHTML = `
    <section class="panel">
      <header><h2>Financial statements</h2><span class="sub">$ millions except per-share figures · XBRL company facts</span>
        <div class="right"><span class="seg" id="stmt">${STMTS.map(([k, l]) => `<button data-k="${k}">${l}</button>`).join("")}</span>
        <span class="seg" id="freq"><button data-k="annual">Annual</button><button data-k="quarterly">Quarterly</button></span></div></header>
      <div class="scroll"><table class="grid fs" id="table"></table></div>
      <div class="note" id="fnote"></div>
    </section>
    <section class="panel">
      <header><h2>Trend</h2><span class="sub" id="csub">Select rows in the table to chart them</span></header>
      <div style="padding: 8px 8px 0"><div id="chart" style="height:320px"></div></div>
    </section>`;

  const draw = () => {
    store.set("fin:stmt", st.stmt); store.set("fin:freq", st.freq); store.set("fin:picked", st.picked);
    root.querySelectorAll("#stmt button").forEach((b) => b.classList.toggle("on", b.dataset.k === st.stmt));
    root.querySelectorAll("#freq button").forEach((b) => b.classList.toggle("on", b.dataset.k === st.freq));
    const data = d[st.freq];
    const periods = data.periods.slice(st.freq === "annual" ? -8 : -12);
    const off = data.periods.length - periods.length;
    const L = data.lines;
    const table = root.querySelector("#table");
    const head = `<thead><tr><th>${st.freq === "annual" ? "Fiscal year" : "Quarter"}</th>${periods.map((p) => `<th class="r" title="Period ending ${p.end}">${esc(p.label)}</th>`).join("")}<th class="r">${st.freq === "annual" ? "YoY" : "QoQ"}</th><th class="c">Trend</th></tr></thead>`;

    if (st.stmt === "ratios") {
      table.innerHTML = head + `<tbody>${RATIOS.map(([label, fn, unit]) => {
        const vals = periods.map((_, i) => fn(L, i + off));
        const last = vals[vals.length - 1], prev = vals[vals.length - 2];
        const show = (v) => (unit === "x" ? (ok(v) ? `${v.toFixed(2)}x` : "—") : pct(v));
        const chg = ok(last) && ok(prev) ? (unit === "x" ? `${(last - prev >= 0 ? "+" : "")}${(last - prev).toFixed(2)}x` : `${(last - prev >= 0 ? "+" : "")}${((last - prev) * 100).toFixed(1)} pts`) : "—";
        return `<tr><td>${label}</td>${vals.map((v) => `<td class="r">${show(v)}</td>`).join("")}<td class="r muted">${chg}</td><td class="c">${spark(vals)}</td></tr>`;
      }).join("")}</tbody>`;
      root.querySelector("#fnote").textContent = "Returns use average equity and assets. Ratios are blank where the company does not tag an input (banks, for example, report no gross profit or capital expenditures).";
    } else {
      table.innerHTML = head + `<tbody>${d.layout[st.stmt].map(([k, label, sub]) => {
        const vals = periods.map((_, i) => L[k][i + off]);
        const perShare = k === "epsDiluted", shares = k === "sharesDiluted";
        const fmt = (v) => (perShare ? (ok(v) ? v.toFixed(2) : "—") : shares ? (ok(v) ? num(v / 1e6, 0) : "—") : mil(v));
        const last = vals[vals.length - 1], prev = vals[vals.length - 2];
        const g = ok(last) && ok(prev) && prev !== 0 ? (last - prev) / Math.abs(prev) : null;
        const src = (d[st.freq].sources[k] || []).join(", ");
        return `<tr class="link ${sub ? "sub" : "total"} ${st.picked.includes(k) ? "sel" : ""}" data-k="${k}" title="${esc(src ? `Source: ${src}` : "Not reported")}">
          <td>${esc(label)}${shares ? " (millions)" : ""}</td>${vals.map((v) => `<td class="r">${fmt(v)}</td>`).join("")}
          <td class="r ${tone(g)}">${pct(g, 1, true)}</td><td class="c">${spark(vals)}</td></tr>`;
      }).join("")}</tbody>`;
      root.querySelector("#fnote").innerHTML = `Hover a row for the XBRL concept behind it; click rows to chart them. ${st.freq === "quarterly" ? "Fourth-quarter flows are derived as the fiscal year less the first three quarters. " : ""}EBITDA is operating income plus depreciation and amortization; free cash flow is cash from operations less capital expenditures.`;
      table.querySelectorAll("tr[data-k]").forEach((tr) => tr.addEventListener("click", () => {
        const k = tr.dataset.k;
        st.picked = st.picked.includes(k) ? st.picked.filter((x) => x !== k) : [...st.picked, k].slice(-5);
        draw();
      }));
    }

    const all = Object.values(d.layout).flat();
    const picked = st.picked.filter((k) => L[k] && !["epsDiluted", "sharesDiluted"].includes(k));
    root.querySelector("#csub").textContent = picked.length ? `${picked.map((k) => all.find((x) => x[0] === k)?.[1]).join(", ")} · $ billions` : "Select rows in the table to chart them";
    chart(root.querySelector("#chart"), picked.map((k, i) => ({
      type: "bar", name: all.find((x) => x[0] === k)?.[1] || k, x: periods.map((p) => p.label),
      y: periods.map((_, j) => (ok(L[k][j + off]) ? L[k][j + off] / 1e9 : null)), marker: { color: PALETTE[i] },
      hovertemplate: `%{x}: $%{y:,.2f}B<extra>${esc(all.find((x) => x[0] === k)?.[1] || k)}</extra>`,
    })), { barmode: "group", yaxis: { tickprefix: "$", ticksuffix: "B" } });
  };

  root.querySelector("#stmt").addEventListener("click", (e) => { if (e.target.dataset.k) { st.stmt = e.target.dataset.k; draw(); } });
  root.querySelector("#freq").addEventListener("click", (e) => { if (e.target.dataset.k) { st.freq = e.target.dataset.k; draw(); } });
  draw();
}

/** Inline sparkline for a row of values. */
export function spark(vals, w = 74, h = 18) {
  const pts = vals.map((v, i) => [i, v]).filter(([, v]) => ok(v));
  if (pts.length < 2) return "";
  const ys = pts.map(([, v]) => v), lo = Math.min(...ys), hi = Math.max(...ys), n = vals.length - 1 || 1;
  const xy = pts.map(([i, v]) => `${((i / n) * (w - 4) + 2).toFixed(1)},${(h - 2 - ((v - lo) / (hi - lo || 1)) * (h - 4)).toFixed(1)}`).join(" ");
  const up = pts[pts.length - 1][1] >= pts[0][1];
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline fill="none" style="stroke:var(${up ? "--pos" : "--neg"})" stroke-width="1.3" points="${xy}"/></svg>`;
}
