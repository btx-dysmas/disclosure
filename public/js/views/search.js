// Filing search: find a phrase across a company's filings, with highlighted excerpts that open in the reader.
import { api, chart, date, esc, failure, loading, PALETTE, store } from "../lib.js";

const SUGGEST = ["cloud revenue", "free cash flow", "artificial intelligence", "guidance", "restructuring", "share repurchase", "impairment", "cybersecurity", "supply chain", "tariffs"];
const SCOPES = [["10-K,10-Q", "Annual and quarterly reports"], ["10-K", "Annual reports"], ["10-Q", "Quarterly reports"], ["8-K", "Current reports"], ["10-K,10-Q,8-K,DEF 14A,S-1,S-4,20-F,6-K", "All major forms"]];

export async function render(root, { co, key, arg }) {
  const k = encodeURIComponent(key);
  const params = new URLSearchParams((arg || "").replace(/^\?/, ""));
  const st = { q: params.get("q") || "", forms: store.get("search:forms", "10-K,10-Q"), start: store.get("search:start", "2001-01-01") };
  root.innerHTML = `
    <section class="panel">
      <header><h2>Search filings</h2><span class="sub">Full text of every ${esc(co.tickers[0] || "company")} filing since 2001, via EDGAR full-text search</span></header>
      <form class="toolbar" id="f">
        <input class="field" name="q" value="${esc(st.q)}" placeholder="Phrase, e.g. cloud revenue" style="width:320px" aria-label="Search phrase" autofocus>
        <select class="field" name="forms" aria-label="Forms">${SCOPES.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select>
        <label>Since <select class="field" name="start">${["2001-01-01", "2016-01-01", "2021-01-01", "2024-01-01"].map((d) => `<option value="${d}">${d.slice(0, 4)}</option>`).join("")}</select></label>
        <button class="btn primary">Search</button>
        <span class="muted" style="font-size:12px">Try ${SUGGEST.map((s) => `<a href="#" data-s="${esc(s)}">${esc(s)}</a>`).join(", ")}</span>
      </form>
      <div id="out"><div class="empty">Several words are searched as an exact phrase. Use AND, OR and quotes for anything more specific.</div></div>
    </section>`;
  const form = root.querySelector("#f");
  form.forms.value = st.forms;
  form.start.value = st.start;

  const run = async () => {
    st.q = form.q.value.trim();
    st.forms = form.forms.value;
    st.start = form.start.value;
    store.set("search:forms", st.forms); store.set("search:start", st.start);
    if (!st.q) return;
    history.replaceState(null, "", `#/c/${k}/search/?q=${encodeURIComponent(st.q)}`);
    const out = root.querySelector("#out");
    out.innerHTML = loading("Searching EDGAR and reading the top matches");
    let r;
    try { r = await api(`/company/${k}/fulltext?q=${encodeURIComponent(st.q)}&forms=${encodeURIComponent(st.forms)}&start=${st.start}`); } catch (e) { out.innerHTML = failure("Search failed", e); return; }
    if (!r.hits.length) { out.innerHTML = `<div class="empty">No ${esc(st.forms.replaceAll(",", ", "))} filings mention ${esc(r.query)} since ${st.start.slice(0, 4)}.</div>`; return; }
    const years = {};
    r.hits.forEach((h) => { const y = (h.filed || "").slice(0, 4); years[y] = (years[y] || 0) + 1; });
    out.innerHTML = `
      <div class="search-head">
        <div><b>${r.total.toLocaleString()}</b> documents mention <b>${esc(r.query)}</b>${r.total > r.hits.length ? `; the ${r.hits.length} most relevant are listed, newest first` : ""}.
          ${Object.entries(r.forms).map(([f, n]) => `<span class="tag">${esc(f)} ${n}</span>`).join("")}</div>
        <div><div class="chart-title">Documents per year</div><div id="yc" style="height:110px"></div></div>
      </div>
      <ol class="results">${r.hits.map((h, i) => `
        <li data-i="${i}">
          <div class="rh"><span class="form">${esc(h.form)}</span> <a href="#/c/${k}/read/${h.accession}${h.fileType && !["10-K", "10-Q", "8-K", "20-F", "DEF 14A"].includes(h.fileType) ? `/${encodeURIComponent(h.file)}` : ""}?find=${encodeURIComponent(st.q.replace(/"/g, ""))}">${esc(h.description || h.fileType || h.file)}</a>
            <span class="muted">filed ${date(h.filed)}${h.period ? ` · period ${date(h.period)}` : ""}${h.matches ? ` · ${h.matches} match${h.matches > 1 ? "es" : ""}` : ""}</span></div>
          ${h.excerpts ? h.excerpts.map((e) => `<a class="ex" href="#/c/${k}/read/${h.accession}${h.fileType && !["10-K", "10-Q", "8-K", "20-F", "DEF 14A"].includes(h.fileType) ? `/${encodeURIComponent(h.file)}` : ""}?block=${e.block}&find=${encodeURIComponent(st.q.replace(/"/g, ""))}">${e.table ? `<span class="muted">[table]</span> ` : ""}${e.html}</a>`).join("") : `<button class="btn small more">Show excerpts</button>`}
        </li>`).join("")}</ol>`;
    const ys = Object.keys(years).sort();
    chart(out.querySelector("#yc"), [{ type: "bar", x: ys, y: ys.map((y) => years[y]), marker: { color: PALETTE[1] }, hovertemplate: "%{x}: %{y} documents<extra></extra>" }],
      { margin: { t: 4, b: 24, l: 30, r: 8 }, yaxis: { dtick: 1, showgrid: false }, xaxis: { type: "category" } });
    out.querySelectorAll(".more").forEach((b) => b.addEventListener("click", async () => {
      const li = b.closest("li"), h = r.hits[+li.dataset.i];
      b.disabled = true; b.textContent = "Reading…";
      try {
        const e = await api(`/filing/${k}/${h.accession}/excerpts?doc=${encodeURIComponent(h.file)}&q=${encodeURIComponent(st.q)}`);
        b.outerHTML = e.excerpts.map((x) => `<a class="ex" href="#/c/${k}/read/${h.accession}?block=${x.block}&find=${encodeURIComponent(st.q.replace(/"/g, ""))}">${x.html}</a>`).join("") || `<span class="muted">No excerpt found.</span>`;
      } catch (err) { b.textContent = err.message; }
    }));
  };
  form.addEventListener("submit", (e) => { e.preventDefault(); run(); });
  form.querySelectorAll("[data-s]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); form.q.value = a.dataset.s; run(); }));
  if (st.q) run();
}
