// Filing comparison: one section of two filings side by side, with new, removed and modified language marked.
import { api, date, esc, failure, loading, store } from "../lib.js";

const DEFAULT_SECTION = { "10-K": "7", "10-Q": "I-2" };

export async function render(root, { co, key, arg }) {
  const k = encodeURIComponent(key);
  root.innerHTML = loading("Loading filings");
  let lib;
  try { lib = await api(`/company/${k}/filings`); } catch (e) { root.innerHTML = failure("Filings unavailable", e); return; }
  const docs = lib.filings.filter((f) => ["10-K", "10-Q"].includes(f.form));
  if (docs.length < 2) { root.innerHTML = `<section class="panel"><div class="empty">Comparison needs at least two 10-K or 10-Q filings.</div></section>`; return; }

  const params = new URLSearchParams((arg || "").replace(/^\?/, ""));
  const st = { type: params.get("type") || store.get("cmp:type", "10-K"), old: params.get("old"), new: params.get("new"), section: params.get("section"), mode: store.get("cmp:mode", "side") };
  const ofType = (t) => docs.filter((f) => f.form === t);
  if (!ofType(st.type).length || ofType(st.type).length < 2) st.type = docs[0].form;

  root.innerHTML = `
    <section class="panel">
      <header><h2>Compare filings</h2><span class="sub">One section at a time, paragraph by paragraph</span></header>
      <div class="toolbar">
        <span class="seg" id="type"><button data-t="10-K">Annual (10-K)</button><button data-t="10-Q">Quarterly (10-Q)</button></span>
        <label>Earlier <select class="field" id="old"></select></label>
        <label>Later <select class="field" id="new"></select></label>
        <label>Section <select class="field" id="sec"></select></label>
        <span class="seg" id="mode"><button data-m="side">Side by side</button><button data-m="inline">Changes only</button></span>
      </div>
      <div id="out"></div>
    </section>`;
  const $ = (id) => root.querySelector(`#${id}`);

  const fillFilings = () => {
    const list = ofType(st.type);
    const opt = (f) => `<option value="${f.accession}">${esc(f.form)} · period ${date(f.period || f.filed)}</option>`;
    $("old").innerHTML = list.map(opt).join("");
    $("new").innerHTML = list.map(opt).join("");
    if (!list.some((f) => f.accession === st.new)) st.new = list[0].accession;
    if (!list.some((f) => f.accession === st.old) || st.old === st.new) {
      // Default to the same period a year earlier for 10-Qs, the prior year for 10-Ks.
      const cur = list.find((f) => f.accession === st.new);
      const yearAgo = list.find((f) => f.period && cur.period && f.period.slice(5, 7) === cur.period.slice(5, 7) && f.period < cur.period);
      st.old = (st.type === "10-Q" && yearAgo ? yearAgo : list[list.indexOf(cur) + 1] || list[1]).accession;
    }
    $("old").value = st.old;
    $("new").value = st.new;
    root.querySelectorAll("#type button").forEach((b) => b.classList.toggle("on", b.dataset.t === st.type));
    root.querySelectorAll("#mode button").forEach((b) => b.classList.toggle("on", b.dataset.m === st.mode));
  };

  async function run() {
    store.set("cmp:type", st.type); store.set("cmp:mode", st.mode);
    const section = st.section || DEFAULT_SECTION[st.type];
    history.replaceState(null, "", `#/c/${k}/compare/?type=${st.type}&old=${st.old}&new=${st.new}&section=${section}`);
    const out = $("out");
    out.innerHTML = loading("Parsing both filings and aligning paragraphs");
    let c;
    try { c = await api(`/company/${k}/compare?old=${st.old}&new=${st.new}&section=${encodeURIComponent(section)}`); } catch (e) { out.innerHTML = failure("Comparison failed", e); return; }
    $("sec").innerHTML = c.sections.map((s) => `<option value="${esc(s.key)}">${esc(s.label)} · ${esc(s.title)}</option>`).join("") + `<option value="all">Entire document</option>`;
    $("sec").value = section;
    const S = c.summary, P = S.paragraphs;
    const head = `<div class="cmp-sum">
        <span><b>${P.changed}</b> paragraphs modified</span><span class="pos"><b>${P.added}</b> added</span><span class="neg"><b>${P.removed}</b> removed</span><span class="muted">${P.equal} unchanged</span>
        <span class="muted">${S.wordsOld.toLocaleString()} → ${S.wordsNew.toLocaleString()} words (${S.wordsNew >= S.wordsOld ? "+" : ""}${(S.wordsNew - S.wordsOld).toLocaleString()})</span>
        ${S.similarity != null ? `<span class="muted">${Math.round(S.similarity * 100)}% of the text carried over</span>` : ""}
      </div>`;
    const rows = st.mode === "inline" ? c.rows.filter((r) => r.op !== "equal") : c.rows;
    const out2 = [];
    let run_ = 0;
    const flush = () => { if (run_) { out2.push(`<div class="cmp-gap">${run_} unchanged paragraph${run_ > 1 ? "s" : ""}</div>`); run_ = 0; } };
    rows.forEach((r, i) => {
      // Long unchanged stretches collapse to a marker, keeping one paragraph of context on each side.
      if (r.op === "equal" && rows[i - 1]?.op === "equal" && rows[i + 1]?.op === "equal") { run_++; return; }
      flush();
      const cls = `cmp-row ${r.op}${r.table ? " tbl" : ""}`;
      out2.push(st.mode === "inline"
        ? `<div class="${cls}"><span class="op">${label(r.op)}</span><div>${r.op === "removed" ? r.left : r.right}${r.op === "changed" ? `<div class="was">${r.left}</div>` : ""}</div></div>`
        : `<div class="${cls}"><div class="l">${r.left ?? ""}</div><div class="r">${r.right ?? ""}</div></div>`);
    });
    flush();
    out.innerHTML = `${head}
      ${st.mode === "side" ? `<div class="cmp-row cmp-head"><div class="l">${esc(c.old.form)} · period ${date(c.old.period)} · <a href="#/c/${k}/read/${c.old.accession}">open</a></div><div class="r">${esc(c.new.form)} · period ${date(c.new.period)} · <a href="#/c/${k}/read/${c.new.accession}">open</a></div></div>` : ""}
      <div class="cmp ${st.mode}">${out2.join("") || `<div class="empty">No differences in this section.</div>`}</div>
      <div class="note">Paragraphs are aligned by content, so moved or lightly edited text is matched rather than shown as removed and re-added. Tables are compared row by row as text. <ins>Green</ins> is new language, <del>red</del> is language removed.</div>`;
  }
  const label = (op) => ({ changed: "Modified", added: "Added", removed: "Removed" })[op] || "";

  $("type").addEventListener("click", (e) => { if (e.target.dataset.t) { st.type = e.target.dataset.t; st.old = st.new = st.section = null; fillFilings(); run(); } });
  $("mode").addEventListener("click", (e) => { if (e.target.dataset.m) { st.mode = e.target.dataset.m; fillFilings(); run(); } });
  $("old").addEventListener("change", (e) => { st.old = e.target.value; run(); });
  $("new").addEventListener("change", (e) => { st.new = e.target.value; run(); });
  $("sec").addEventListener("change", (e) => { st.section = e.target.value; run(); });
  fillFilings();
  run();
}
