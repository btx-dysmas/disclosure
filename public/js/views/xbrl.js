// XBRL explorer: search every concept a company reports, inspect its facts, and see how a filing is structured.
import { api, chart, date, esc, failure, loading, num, ok, store } from "../lib.js";

export async function render(root, { co, key, arg }) {
  root.innerHTML = loading("Loading the company's XBRL facts");
  const k = encodeURIComponent(key);
  let d, lib;
  try { [d, lib] = await Promise.all([api(`/company/${k}/xbrl`), api(`/company/${k}/filings`)]); } catch (e) { root.innerHTML = failure("XBRL data unavailable", e); return; }
  const taxes = [...new Set(d.concepts.map((c) => c.taxonomy))];
  const xbrlFilings = lib.filings.filter((f) => f.xbrl && ["10-K", "10-Q", "20-F", "40-F", "10-K/A", "10-Q/A"].includes(f.form)).slice(0, 24);
  let sel = arg || store.get(`xbrl:${co.cik}`, "us-gaap/Revenues");
  if (!d.concepts.some((c) => `${c.taxonomy}/${c.concept}` === sel)) sel = `${d.concepts[0].taxonomy}/${d.concepts[0].concept}`;

  root.innerHTML = `
    <div class="cols side-wide">
      <section class="panel">
        <header><h2>Concepts</h2><span class="sub">${d.concepts.length.toLocaleString()} reported</span></header>
        <div class="toolbar">
          <input class="field" id="q" placeholder="Search labels and tags" style="flex:1; min-width:0" aria-label="Search concepts">
          <select class="field" id="tax" aria-label="Taxonomy"><option value="">All taxonomies</option>${taxes.map((t) => `<option>${esc(t)}</option>`).join("")}</select>
        </div>
        <div class="clist" id="list"></div>
      </section>
      <div>
        <section class="panel" id="detail"></section>
        <section class="panel">
          <header><h2>Reporting structure</h2><span class="sub">How one filing's XBRL is organized</span>
            <div class="right"><select class="field" id="filing" aria-label="Filing">${xbrlFilings.map((f) => `<option value="${f.accession}">${esc(f.form)} · ${date(f.filed)}</option>`).join("")}</select></div></header>
          <div id="structure"></div>
        </section>
      </div>
    </div>`;

  const list = root.querySelector("#list"), q = root.querySelector("#q"), tax = root.querySelector("#tax");
  const drawList = () => {
    const s = q.value.trim().toLowerCase();
    const rows = d.concepts.filter((c) => (!tax.value || c.taxonomy === tax.value) && (!s || c.label.toLowerCase().includes(s) || c.concept.toLowerCase().includes(s)));
    list.innerHTML = rows.slice(0, 400).map((c) => {
      const id = `${c.taxonomy}/${c.concept}`;
      return `<a href="#" data-id="${esc(id)}" class="${id === sel ? "on" : ""}"><span>${esc(c.label)}</span><small>${esc(c.taxonomy)}:${esc(c.concept)} · ${c.count} facts · to ${c.last.slice(0, 4)}</small></a>`;
    }).join("") + (rows.length > 400 ? `<div class="empty">${rows.length - 400} more; refine the search.</div>` : rows.length ? "" : `<div class="empty">No concepts match.</div>`);
  };
  list.addEventListener("click", (e) => {
    const a = e.target.closest("a[data-id]");
    if (!a) return;
    e.preventDefault();
    sel = a.dataset.id;
    list.querySelectorAll("a").forEach((x) => x.classList.toggle("on", x === a));
    detail();
  });
  q.addEventListener("input", drawList);
  tax.addEventListener("change", drawList);

  async function detail() {
    store.set(`xbrl:${co.cik}`, sel);
    const el = root.querySelector("#detail");
    el.innerHTML = loading("Loading facts");
    let f;
    try { f = await api(`/company/${k}/xbrl/${sel}`); } catch (e) { el.innerHTML = failure("Concept unavailable", e); return; }
    const units = [...new Set(f.facts.map((x) => x.unit))];
    const unit = units[0];
    const annual = new Map();
    for (const x of f.facts) {
      if (x.unit !== unit || !(x.form || "").startsWith("10-K") || (x.fp && x.fp !== "FY")) continue;
      const days = x.start ? (Date.parse(x.end) - Date.parse(x.start)) / 864e5 : null;
      if (days !== null && (days < 350 || days > 380)) continue;
      if (!annual.has(x.end) || x.filed > annual.get(x.end).filed) annual.set(x.end, x);
    }
    const series = [...annual.values()].sort((a, b) => (a.end < b.end ? -1 : 1));
    const fmt = (v) => (unit === "USD" ? (Math.abs(v) >= 1e6 ? `$${num(v / 1e6, 1)}M` : `$${num(v, 2)}`) : unit === "USD/shares" ? `$${v.toFixed(2)}` : unit === "pure" ? `${(v * 100).toFixed(2)}%` : num(v, Math.abs(v) < 100 ? 2 : 0));
    el.innerHTML = `
      <header><h2>${esc(f.label || f.concept)}</h2><span class="sub mono">${esc(f.taxonomy)}:${esc(f.concept)}</span></header>
      <div class="body" style="padding-bottom:4px">
        <p class="desc">${esc(f.description || "No description in the taxonomy.")}</p>
        <div class="muted" style="font-size:12px">Units: ${units.map(esc).join(", ")} · ${f.facts.length} facts reported${series.length ? ` · annual values from 10-K filings charted below` : ""}</div>
      </div>
      ${series.length > 1 ? `<div style="padding:0 8px"><div id="xc" style="height:220px"></div></div>` : ""}
      <div class="scroll" style="max-height:340px"><table class="grid">
        <thead><tr><th>Period</th><th class="r">Value</th><th>Unit</th><th>Form</th><th>Fiscal</th><th>Filed</th><th>Filing</th><th>Frame</th></tr></thead>
        <tbody>${f.facts.slice(0, 300).map((x) => `<tr>
          <td>${x.start ? `${esc(x.start)} to ` : ""}${esc(x.end)}</td><td class="r">${fmt(x.val)}</td><td class="muted">${esc(x.unit)}</td>
          <td class="form">${esc(x.form || "")}</td><td class="muted">${esc(x.fy || "")} ${esc(x.fp || "")}</td><td>${esc(x.filed || "")}</td>
          <td class="mono">${x.accession ? `<a href="#/c/${k}/read/${esc(x.accession)}">${esc(x.accession)}</a>` : ""}</td><td class="muted mono">${esc(x.frame || "")}</td></tr>`).join("")}
        </tbody></table></div>
      <div class="note">Every fact as filed, newest period first. The same period appears once per filing that reported it; a later value for the same period is a restatement or a comparative. Frames mark the value the SEC uses for cross-company comparisons.</div>`;
    if (series.length > 1) {
      const big = unit === "USD" && Math.max(...series.map((x) => Math.abs(x.val))) >= 1e9;
      chart(el.querySelector("#xc"), [{
        type: "bar", x: series.map((x) => x.end.slice(0, 4)), y: series.map((x) => (big ? x.val / 1e9 : x.val)), marker: { color: "#1f3a66" },
        hovertemplate: big ? "%{x}: $%{y:,.2f}B<extra></extra>" : "%{x}: %{y:,}<extra></extra>",
      }], { margin: { t: 8, b: 30 }, yaxis: big ? { tickprefix: "$", ticksuffix: "B" } : {} });
    }
  }

  async function structure() {
    const el = root.querySelector("#structure");
    const acc = root.querySelector("#filing").value;
    if (!acc) { el.innerHTML = `<div class="empty">No filings with XBRL on record.</div>`; return; }
    el.innerHTML = loading("Reading FilingSummary.xml and MetaLinks.json");
    let s;
    try { s = await api(`/filing/${k}/${acc}/structure`); } catch (e) { el.innerHTML = failure("Structure unavailable", e); return; }
    if (!s.reports.length) { el.innerHTML = `<div class="empty">${esc(s.reason || "No XBRL reports in this filing.")}</div>`; return; }
    const cats = {};
    s.reports.forEach((r) => (cats[r.category] ??= []).push(r));
    const st = s.stats;
    el.innerHTML = `
      ${st ? `<dl class="kv two">
        <dt>Distinct elements</dt><dd>${num(st.elementCount)}</dd><dt>Contexts</dt><dd>${num(st.contextCount)}</dd>
        <dt>Standard line items</dt><dd>${num(st.keyStandard)}</dd><dt>Company-specific line items</dt><dd>${num(st.keyCustom)}</dd>
        <dt>Standard axes / members</dt><dd>${num(st.axisStandard)} / ${num(st.memberStandard)}</dd><dt>Custom axes / members</dt><dd>${num(st.axisCustom)} / ${num(st.memberCustom)}</dd>
      </dl>` : ""}
      <div class="structure">${Object.entries(cats).map(([c, rs]) => `<div><h3>${esc(c)} <span class="muted">${rs.length}</span></h3><ol>${rs.map((r) => `<li><a href="#/c/${k}/read/${acc}/${encodeURIComponent(r.file)}">${esc(r.short)}</a></li>`).join("")}</ol></div>`).join("")}</div>
      ${st?.customExamples?.length ? `<div class="note">Company-specific (extension) elements include ${st.customExamples.slice(0, 8).map((t) => `<code>${esc(t)}</code>`).join(", ")}. Extensions are used where the standard taxonomy has no suitable concept; a high share makes a filing harder to compare with peers.</div>` : ""}`;
  }
  root.querySelector("#filing").addEventListener("change", structure);

  drawList();
  detail();
  structure();
}
