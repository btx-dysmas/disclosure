// Company overview: rule-based summary, key figures, recent reports and registrant details.
import { api, date, esc, failure, loading, mil, ok, pct, tone } from "../lib.js";
import { spark } from "./financials.js";

const MAIN_FORMS = new Set(["10-K", "10-Q", "8-K", "20-F", "6-K", "DEF 14A", "10-K/A", "10-Q/A", "S-1", "S-4"]);

export async function render(root, { co, key }) {
  root.innerHTML = loading("Reading financial statements and recent filings");
  const k = encodeURIComponent(key);
  const [ins, fin, lib] = await Promise.allSettled([api(`/company/${k}/insights`), api(`/company/${k}/financials`), api(`/company/${k}/filings`)]);

  const recent = lib.status === "fulfilled" ? lib.value.filings.filter((f) => MAIN_FORMS.has(f.form)).slice(0, 10) : [];
  root.innerHTML = `
    <div class="cols wide-left">
      <section class="panel">
        <header><h2>Summary</h2><span class="sub">${ins.status === "fulfilled" && ins.value.period ? `${esc(ins.value.period)} annual report and the latest quarter` : ""}</span></header>
        <div id="ins"></div>
        <div class="note">Written by rules from the reported figures: each sentence is computed from the statements and segment data on this site, with no language model involved.</div>
      </section>
      <div>
        <section class="panel">
          <header><h2>Key figures</h2><span class="sub">$ millions</span><div class="right"><a href="#/c/${k}/financials">Statements</a></div></header>
          <div id="kf"></div>
        </section>
        <section class="panel">
          <header><h2>Recent reports</h2><div class="right"><a href="#/c/${k}/filings">All filings</a></div></header>
          ${recent.length ? `<table class="grid"><tbody>${recent.map((f) => `
            <tr><td class="form">${esc(f.form)}</td><td><a href="#/c/${k}/read/${f.accession}">${esc(f.name)}</a>${f.items.filter((i) => i.code !== "9.01").slice(0, 2).map((i) => `<div class="muted">${esc(i.label)}</div>`).join("")}</td><td class="r">${date(f.filed)}</td></tr>`).join("")}</tbody></table>` : `<div class="empty">No reports on file.</div>`}
        </section>
        <section class="panel">
          <header><h2>Registrant</h2></header>
          <dl class="kv">
            <dt>Business address</dt><dd>${esc(co.address || "—")}</dd>
            <dt>Phone</dt><dd>${esc(co.phone || "—")}</dd>
            <dt>EIN</dt><dd class="mono">${esc(co.ein || "—")}</dd>
            <dt>Entity type</dt><dd>${esc(co.entityType || "—")}</dd>
            <dt>Filings on EDGAR</dt><dd>${co.filingCount.toLocaleString()}</dd>
            ${co.formerNames.length ? `<dt>Former names</dt><dd>${co.formerNames.slice(0, 3).map(esc).join("<br>")}</dd>` : ""}
          </dl>
        </section>
      </div>
    </div>`;

  const insEl = root.querySelector("#ins");
  if (ins.status === "rejected") insEl.innerHTML = failure("Summary unavailable", ins.reason);
  else if (!ins.value.sections.length) insEl.innerHTML = `<div class="empty">Not enough annual data in XBRL to write a summary.</div>`;
  else insEl.innerHTML = ins.value.sections.map((s) => `<div class="insight"><h3>${esc(s.topic)}</h3><ul>${s.points.map((p) => `<li>${esc(p)}</li>`).join("")}</ul></div>`).join("");

  const kf = root.querySelector("#kf");
  if (fin.status === "rejected") { kf.innerHTML = failure("Figures unavailable", fin.reason); return; }
  const A = fin.value.annual, L = A.lines, n = A.periods.length, cols = A.periods.slice(-5), off = n - cols.length;
  const row = (label, vals, fmt, cls = "") => `<tr class="${cls}"><td>${label}</td>${vals.map((v) => `<td class="r">${fmt(v)}</td>`).join("")}<td class="c">${spark(vals, 56, 16)}</td></tr>`;
  const at = (key) => cols.map((_, i) => L[key][i + off]);
  const growth = cols.map((_, i) => (ok(L.revenue[i + off]) && ok(L.revenue[i + off - 1]) && L.revenue[i + off - 1] ? L.revenue[i + off] / L.revenue[i + off - 1] - 1 : null));
  const margin = cols.map((_, i) => (ok(L.operatingIncome[i + off]) && L.revenue[i + off] ? L.operatingIncome[i + off] / L.revenue[i + off] : null));
  kf.innerHTML = `<table class="grid nowrap-first"><thead><tr><th></th>${cols.map((p) => `<th class="r">${esc(p.label)}</th>`).join("")}<th></th></tr></thead><tbody>
    ${row("Revenue", at("revenue"), mil, "total")}
    ${row("Growth", growth, (v) => `<span class="${tone(v)}">${pct(v, 1, true)}</span>`)}
    ${row("Operating margin", margin, (v) => pct(v))}
    ${row("Net income", at("netIncome"), mil)}
    ${row("Diluted EPS", at("epsDiluted"), (v) => (ok(v) ? v.toFixed(2) : "—"))}
    ${row("Free cash flow", at("fcf"), mil)}
    ${row("Net debt (cash)", at("netDebt"), mil)}
  </tbody></table>`;
}
