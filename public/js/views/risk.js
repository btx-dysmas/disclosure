// Risk factors: what was added, removed and reworded between two 10-Ks, and how themes shift over years.
import { api, date, esc, failure, loading } from "../lib.js";

const STATUS = { added: "Added", removed: "Removed", modified: "Modified", minor: "Minor edits", unchanged: "Unchanged" };

export async function render(root, { co, key }) {
  const k = encodeURIComponent(key);
  root.innerHTML = loading("Reading Item 1A from the last five annual reports");
  let y;
  try { y = await api(`/company/${k}/risks`); } catch (e) { root.innerHTML = failure("Risk factors unavailable", e); return; }
  if (!y.filings.length) { root.innerHTML = `<section class="panel"><div class="empty">No risk factors section (Item 1A) found in this company's annual reports.</div></section>`; return; }

  const F = y.filings;
  const opt = (f) => `<option value="${f.accession}">${esc(f.form)} filed ${date(f.filed)}</option>`;
  root.innerHTML = `
    <section class="panel">
      <header><h2>Risk themes over time</h2><span class="sub">Mentions per 10,000 words of Item 1A · darker is more frequent</span></header>
      <div class="scroll"><table class="grid heat" id="heat"></table></div>
      <div class="note">Counts of theme vocabulary in the risk factors section, scaled by its length so a longer section does not inflate every theme. Useful for spotting when a topic enters or grows; read the risks themselves for what changed.</div>
    </section>
    ${F.length > 1 ? `<section class="panel">
      <header><h2>Changes between annual reports</h2>
        <div class="right"><label class="muted">Compare <select class="field" id="old">${F.slice(1).map(opt).join("")}</select></label>
        <label class="muted">with <select class="field" id="new">${F.map(opt).join("")}</select></label></div></header>
      <div id="cmp"></div>
    </section>` : ""}`;

  const years = F.map((f) => f.filed.slice(0, 4)).reverse();
  const vals = y.themes.values.slice().reverse();
  const max = Math.max(1, ...vals.flatMap((r) => Object.values(r)));
  root.querySelector("#heat").innerHTML = `
    <thead><tr><th>Theme</th>${years.map((yr) => `<th class="r">${yr} 10-K</th>`).join("")}<th class="r">Change</th></tr></thead>
    <tbody>
      ${y.themes.names.map((n) => {
        const row = vals.map((r) => r[n]);
        const d = row[row.length - 1] - row[0];
        return `<tr><td>${esc(n)}</td>${row.map((v) => `<td class="r" style="background:rgba(31,58,102,${(0.08 + 0.62 * (v / max)).toFixed(2)}); color:${v / max > 0.55 ? "#fff" : "inherit"}">${v.toFixed(1)}</td>`).join("")}
          <td class="r ${d > 0.5 ? "neg" : d < -0.5 ? "pos" : "muted"}">${d > 0 ? "+" : ""}${d.toFixed(1)}</td></tr>`;
      }).join("")}
      <tr class="total"><td>Risk factors listed</td>${F.slice().reverse().map((f) => `<td class="r">${f.count}</td>`).join("")}<td></td></tr>
      <tr><td class="muted">Words in Item 1A</td>${F.slice().reverse().map((f) => `<td class="r muted">${f.words.toLocaleString()}</td>`).join("")}<td></td></tr>
    </tbody>`;

  if (F.length < 2) return;
  const oldSel = root.querySelector("#old"), newSel = root.querySelector("#new");
  oldSel.value = F[1].accession;
  newSel.value = F[0].accession;
  let filter = "changed";

  async function compare() {
    const el = root.querySelector("#cmp");
    if (oldSel.value === newSel.value) { el.innerHTML = `<div class="empty">Pick two different filings.</div>`; return; }
    const [o, n] = [F.find((f) => f.accession === oldSel.value), F.find((f) => f.accession === newSel.value)];
    const [older, newer] = o.filed < n.filed ? [o, n] : [n, o];
    el.innerHTML = loading("Matching risks and comparing their text");
    let c;
    try { c = await api(`/company/${k}/risks/compare?old=${older.accession}&new=${newer.accession}`); } catch (e) { el.innerHTML = failure("Comparison failed", e); return; }
    const S = c.summary;
    const draw = () => {
      const rows = c.rows.filter((r) => filter === "all" || (filter === "changed" ? ["added", "removed", "modified"].includes(r.status) : r.status === filter));
      el.innerHTML = `
        <div class="toolbar">
          <span class="seg" id="flt">
            ${[["changed", `Material changes ${S.added + S.removed + S.modified}`], ["added", `Added ${S.added}`], ["removed", `Removed ${S.removed}`], ["modified", `Modified ${S.modified}`], ["minor", `Minor edits ${S.minor}`], ["unchanged", `Unchanged ${S.unchanged}`], ["all", "All"]].map(([f, l]) => `<button data-f="${f}" class="${f === filter ? "on" : ""}">${l}</button>`).join("")}
          </span>
          <span class="count">${esc(older.form)} ${date(older.filed)} → ${esc(newer.form)} ${date(newer.filed)}</span>
        </div>
        <ol class="risks">${rows.map((r) => `
          <li class="${r.status}">
            <details ${r.status === "added" || r.status === "removed" ? "" : ""}>
              <summary>
                <span class="st st-${r.status}">${STATUS[r.status]}</span>
                <span class="rt">${r.titleHtml || esc(r.title)}</span>
                <span class="rm">${r.category ? `${esc(cap(r.category))} · ` : ""}${r.words} words${r.wordChange ? ` (${r.wordChange > 0 ? "+" : ""}${r.wordChange})` : ""}</span>
              </summary>
              <div class="rb diffbody">${r.html ?? "<span class='muted'>Text is identical.</span>"}</div>
              ${r.status !== "removed" ? `<a class="small-link" href="#/c/${k}/read/${newer.accession}?block=${r.block}">Open in the ${esc(newer.form)} ↗</a>` : `<a class="small-link" href="#/c/${k}/read/${older.accession}?block=${r.block}">Open in the ${esc(older.form)} ↗</a>`}
            </details>
          </li>`).join("") || `<li class="empty">Nothing in this category.</li>`}</ol>
        <div class="note">Risks are matched by heading, then by text where a heading was rewritten. In modified risks, <ins>inserted</ins> and <del>deleted</del> words are marked. “Minor edits” changed less than 1.5% of the text.</div>`;
      el.querySelector("#flt").addEventListener("click", (e) => { if (e.target.dataset.f) { filter = e.target.dataset.f; draw(); } });
    };
    draw();
  }
  oldSel.addEventListener("change", compare);
  newSel.addEventListener("change", compare);
  compare();
}

const cap = (s) => (s === s.toUpperCase() ? s.charAt(0) + s.slice(1).toLowerCase() : s);
