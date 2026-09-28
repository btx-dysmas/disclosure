// Filing reader: a cleaned-up filing with section navigation, in-document search and figure highlighting.
import { api, date, esc, failure, loading, store } from "../lib.js";

const FIGURE = /(\$\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:million|billion|trillion|thousand))?|\b\d+(?:\.\d+)?\s?(?:%|percent\b|basis points\b))/gi;

export async function render(root, { co, key, arg }) {
  let [acc, rest] = (arg || "").split("?");
  const params = new URLSearchParams(rest || "");
  let path = null;
  if (acc && acc.includes("/")) [acc, path] = [acc.slice(0, acc.indexOf("/")), acc.slice(acc.indexOf("/") + 1)];

  if (!acc) {
    root.innerHTML = loading("Finding the latest annual or quarterly report");
    try {
      const f = await api(`/company/${encodeURIComponent(key)}/latest`);
      location.replace(`#/c/${encodeURIComponent(key)}/read/${f.accession}`);
    } catch (e) { root.innerHTML = failure("No 10-K or 10-Q on file", e); }
    return;
  }

  root.innerHTML = loading("Downloading and cleaning the filing");
  let d;
  try {
    d = await api(`/filing/${encodeURIComponent(key)}/${acc}${path ? `?doc=${encodeURIComponent(path)}` : ""}`);
  } catch (e) { root.innerHTML = failure("Filing could not be opened", e); return; }

  const f = d.filing;
  const primary = d.path === f.doc;
  const docs = d.documents.filter((x) => x.name && !/\.(jpg|gif|png|xsd|zip|json)$/i.test(x.name) && !/^R\d+\.htm$/.test(x.name) && x.type !== "XML");
  const saved = () => store.get("filings", []).some((x) => x.accession === f.accession);

  root.innerHTML = `
    <div class="reader">
      <aside class="panel rnav">
        <header><h2>${esc(f.form)}</h2><span class="sub">${date(f.filed)}</span></header>
        <div class="rmeta">
          <div>${esc(f.name)}</div>
          ${f.period ? `<div class="muted">Period ending ${date(f.period)}</div>` : ""}
          <div class="mono muted">${esc(f.accession)}</div>
        </div>
        ${d.sections.length ? `<h3>Sections</h3><ol class="toc">${d.sections.map((s) => `<li><a href="#" data-b="${s.block}"><span>${esc(s.label)}</span>${esc(s.title)}</a></li>`).join("")}</ol>` : ""}
        ${d.notes.length ? `<h3>Notes to the financial statements</h3><ol class="toc notes">${d.notes.map((n) => `<li><a href="#" data-b="${n.block}" class="${n.segment ? "seg-note" : ""}">${esc(tidy(n.title))}</a></li>`).join("")}</ol>` : ""}
        ${docs.length > 1 ? `<h3>Documents in this filing</h3><ol class="toc docs">${docs.map((x) => `<li><a href="#/c/${encodeURIComponent(key)}/read/${f.accession}/${encodeURIComponent(x.path)}" class="${x.path === d.path ? "on" : ""}"><span>${esc(x.type || x.seq)}</span>${esc(x.description || x.name)}</a></li>`).join("")}</ol>` : ""}
      </aside>
      <section class="panel rmain">
        <div class="toolbar rbar">
          <input class="field" id="find" placeholder="Search this document" style="width:260px" aria-label="Search this document" value="${esc(params.get("find") || "")}">
          <button class="btn small" id="prev" aria-label="Previous match">↑</button><button class="btn small" id="next" aria-label="Next match">↓</button>
          <span class="count" id="hits" style="margin-left:0"></span>
          <label><input type="checkbox" id="figs"> Highlight figures</label>
          <span style="margin-left:auto; display:flex; gap:8px">
            <button class="btn small" id="save">${saved() ? "Saved to workspace" : "Save filing"}</button>
            <a class="btn small" href="${esc(d.url)}" target="_blank" rel="noopener">Original on EDGAR</a>
          </span>
        </div>
        ${d.unsupported ? `<div class="empty">This document is a ${esc(d.unsupported)}. <a href="${esc(d.url)}" target="_blank" rel="noopener">Open it on EDGAR</a>.</div>` : ""}
        <article class="doc" id="doc">${d.blocks.map(([k, h], i) => k === "t" ? `<div class="tw" id="b${i}">${h}</div>` : `<p id="b${i}" class="${k === "h" ? "hd" : ""}">${h}</p>`).join("")}</article>
        ${!primary ? "" : `<div class="note">Rebuilt from the filing's HTML for reading. Formatting is simplified; the text and figures are as filed.</div>`}
      </section>
    </div>`;

  const doc = root.querySelector("#doc");
  root.querySelectorAll("[data-b]").forEach((a) => a.addEventListener("click", (e) => {
    e.preventDefault();
    doc.querySelector(`#b${a.dataset.b}`)?.scrollIntoView({ block: "start" });
  }));

  // Current section follows the scroll position.
  const marks = d.sections.map((s) => [s.block, root.querySelector(`.toc a[data-b="${s.block}"]`)]);
  const spy = () => {
    let cur = null;
    for (const [b, a] of marks) { const el = doc.querySelector(`#b${b}`); if (el && el.getBoundingClientRect().top < 140) cur = a; }
    marks.forEach(([, a]) => a.classList.toggle("on", a === cur));
  };
  window.addEventListener("scroll", spy, { passive: true });
  window.addEventListener("hashchange", () => window.removeEventListener("scroll", spy), { once: true });

  root.querySelector("#save").addEventListener("click", (e) => {
    const list = store.get("filings", []);
    const i = list.findIndex((x) => x.accession === f.accession);
    if (i >= 0) list.splice(i, 1);
    else list.unshift({ accession: f.accession, form: f.form, filed: f.filed, company: co.name, ticker: co.tickers[0], cik: co.cik });
    store.set("filings", list);
    e.target.textContent = saved() ? "Saved to workspace" : "Save filing";
  });

  // In-document search.
  let hits = [], at = -1;
  const find = root.querySelector("#find"), count = root.querySelector("#hits");
  const go = (n) => {
    if (!hits.length) return;
    hits[at]?.classList.remove("cur");
    at = (n + hits.length) % hits.length;
    hits[at].classList.add("cur");
    hits[at].scrollIntoView({ block: "center" });
    count.textContent = `${at + 1} of ${hits.length}`;
  };
  const search = () => {
    unwrap(doc, "mark.hit");
    const q = find.value.trim();
    hits = q.length > 1 ? wrap(doc, new RegExp(escapeRe(q), "gi"), "mark", "hit") : [];
    at = -1;
    count.textContent = q.length > 1 ? (hits.length ? `${hits.length} matches` : "No matches") : "";
    if (hits.length) go(0);
  };
  let t = null;
  find.addEventListener("input", () => { clearTimeout(t); t = setTimeout(search, 250); });
  find.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); go(at + (e.shiftKey ? -1 : 1)); } });
  root.querySelector("#next").addEventListener("click", () => go(at + 1));
  root.querySelector("#prev").addEventListener("click", () => go(at - 1));

  const figs = root.querySelector("#figs");
  figs.checked = store.get("figures", false);
  const drawFigs = () => {
    store.set("figures", figs.checked);
    unwrap(doc, "span.fig");
    if (figs.checked) wrap(doc, FIGURE, "span", "fig", (n) => !n.parentElement.closest("table"));
  };
  figs.addEventListener("change", () => { drawFigs(); search(); });
  drawFigs();

  const jump = params.get("block");
  if (find.value) {
    search();
    if (jump && hits.length) {
      // Start at the match inside the block the excerpt came from.
      const target = doc.querySelector(`#b${jump}`);
      const n = hits.findIndex((h) => target && (target.contains(h) || target.compareDocumentPosition(h) & Node.DOCUMENT_POSITION_FOLLOWING));
      if (n > 0) go(n);
    }
  }
  else if (jump) doc.querySelector(`#b${jump}`)?.scrollIntoView({ block: "start" });
  else if (params.get("note") === "segment") {
    const n = d.notes.find((x) => x.segment);
    if (n) doc.querySelector(`#b${n.block}`)?.scrollIntoView({ block: "start" });
  } else if (params.get("section")) {
    const s = d.sections.find((x) => x.key === params.get("section"));
    if (s) doc.querySelector(`#b${s.block}`)?.scrollIntoView({ block: "start" });
  }
}

const tidy = (t) => t.replace(/\s+/g, " ").replace(/^NOTE\s+/i, "Note ").replace(/([A-Z][A-Z'’,&()\- ]{3,})$/, (m) => m.charAt(0) + m.slice(1).toLowerCase());
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Wrap every regex match in text nodes under `root`. Returns the new elements in document order. */
function wrap(root, re, tag, cls, accept = () => true) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) { const n = walker.currentNode; re.lastIndex = 0; if (n.nodeValue.trim() && re.test(n.nodeValue) && accept(n)) nodes.push(n); }
  const out = [];
  for (const n of nodes) {
    const frag = document.createDocumentFragment();
    const s = n.nodeValue;
    let last = 0;
    re.lastIndex = 0;
    for (let m; (m = re.exec(s)); ) {
      if (!m[0]) { re.lastIndex++; continue; }
      frag.append(s.slice(last, m.index));
      const el = document.createElement(tag);
      el.className = cls;
      el.textContent = m[0];
      frag.append(el);
      out.push(el);
      last = m.index + m[0].length;
    }
    frag.append(s.slice(last));
    n.replaceWith(frag);
  }
  return out;
}

function unwrap(root, sel) {
  const parents = new Set();
  root.querySelectorAll(sel).forEach((el) => { parents.add(el.parentNode); el.replaceWith(el.textContent); });
  parents.forEach((p) => p.normalize());
}
