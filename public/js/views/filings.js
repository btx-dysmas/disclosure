// Filing library: every filing, filterable by form, date and keyword.
import { api, bytes, date, esc, failure, loading, store } from "../lib.js";

const GROUPS = {
  annual: ["10-K", "10-K/A", "10-KT", "20-F", "40-F"],
  quarterly: ["10-Q", "10-Q/A"],
  current: ["8-K", "8-K/A", "6-K"],
  proxy: ["DEF 14A", "DEFA14A", "PRE 14A", "DEFM14A"],
  insider: ["3", "4", "4/A", "5", "144"],
  offering: ["S-1", "S-1/A", "S-3", "S-3ASR", "S-4", "S-8", "424B2", "424B3", "424B5", "FWP"],
  ownership: ["13F-HR", "13F-NT", "SC 13G", "SC 13G/A", "SC 13D", "SC 13D/A", "SCHEDULE 13G", "SCHEDULE 13G/A", "SCHEDULE 13D", "SCHEDULE 13D/A"],
};
const GROUP_LABEL = { all: "All filings", annual: "Annual reports", quarterly: "Quarterly reports", current: "Current reports (8-K)", proxy: "Proxy statements", insider: "Insider (Forms 3, 4, 5)", offering: "Registrations and prospectuses", ownership: "Ownership (13F, 13D, 13G)" };

export async function render(root, { co, key }) {
  root.innerHTML = loading("Loading filing index from EDGAR");
  let lib;
  try { lib = await api(`/company/${encodeURIComponent(key)}/filings`); } catch (e) { root.innerHTML = failure("Filing index unavailable", e); return; }

  const saved = store.get("filters", {});
  const st = { group: saved.group || "all", form: "", from: "", to: "", q: "" };

  root.innerHTML = `
    <section class="panel">
      <header><h2>Filing library</h2><span class="sub">${lib.complete ? "Complete history" : `Most recent ${lib.filings.length.toLocaleString()} filings`}</span>
        <div class="right">${lib.complete ? "" : `<button class="btn small" id="all">Load ${lib.olderCount.toLocaleString()} older filings</button>`}</div></header>
      <div class="toolbar">
        <select class="field" id="group" aria-label="Filing group">${Object.entries(GROUP_LABEL).map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}</select>
        <select class="field" id="form" aria-label="Form type"></select>
        <label>From <input class="field" type="date" id="from"></label>
        <label>To <input class="field" type="date" id="to"></label>
        <input class="field" id="kw" placeholder="Keyword, item or accession" style="width:220px" aria-label="Keyword">
        <button class="btn small" id="reset">Clear</button>
        <span class="count" id="count"></span>
      </div>
      <div class="scroll" style="max-height: 70vh"><table class="grid">
        <thead><tr><th>Form</th><th>Description</th><th class="r">Filed</th><th class="r">Period</th><th>Status</th><th>Accession number</th><th class="r">Size</th><th></th></tr></thead>
        <tbody id="rows"></tbody>
      </table></div>
    </section>`;

  const $ = (id) => root.querySelector(`#${id}`);
  $("group").value = st.group;

  function forms() {
    const set = [...new Set(lib.filings.map((f) => f.form))].filter((f) => st.group === "all" || GROUPS[st.group].includes(f)).sort();
    $("form").innerHTML = `<option value="">All form types</option>${set.map((f) => `<option>${esc(f)}</option>`).join("")}`;
    $("form").value = set.includes(st.form) ? st.form : "";
    st.form = $("form").value;
  }

  function draw() {
    const q = st.q.toLowerCase();
    const rows = lib.filings.filter((f) =>
      (st.group === "all" || GROUPS[st.group].includes(f.form)) && (!st.form || f.form === st.form) &&
      (!st.from || f.filed >= st.from) && (!st.to || f.filed <= st.to) &&
      (!q || `${f.form} ${f.name} ${f.description} ${f.accession} ${f.items.map((i) => `${i.code} ${i.label}`).join(" ")}`.toLowerCase().includes(q)));
    $("count").textContent = `${rows.length.toLocaleString()} of ${lib.filings.length.toLocaleString()}`;
    const shown = rows.slice(0, 500);
    $("rows").innerHTML = shown.map((f) => `
      <tr>
        <td class="form">${esc(f.form)}</td>
        <td><a href="#/c/${encodeURIComponent(key)}/read/${f.accession}">${esc(f.name)}</a>${f.items.length ? `<div>${f.items.filter((i) => i.code !== "9.01").map((i) => `<span class="tag">${esc(i.code)} ${esc(i.label)}</span>`).join("")}</div>` : ""}</td>
        <td class="r">${date(f.filed)}</td>
        <td class="r">${f.period ? date(f.period) : "—"}</td>
        <td>${f.status === "Amendment" ? `<span class="tag amend">Amendment</span>` : "Original"}</td>
        <td class="mono">${esc(f.accession)}</td>
        <td class="r muted">${bytes(f.size)}</td>
        <td class="r"><a href="${esc(f.index)}" target="_blank" rel="noopener">EDGAR</a></td>
      </tr>`).join("") || `<tr><td colspan="8" class="empty">No filings match these filters.</td></tr>`;
    if (rows.length > shown.length) $("rows").insertAdjacentHTML("beforeend", `<tr><td colspan="8" class="muted">Showing the first 500. Narrow the filters to see the rest.</td></tr>`);
  }

  $("group").addEventListener("change", (e) => { st.group = e.target.value; store.set("filters", { group: st.group }); forms(); draw(); });
  $("form").addEventListener("change", (e) => { st.form = e.target.value; draw(); });
  $("from").addEventListener("change", (e) => { st.from = e.target.value; draw(); });
  $("to").addEventListener("change", (e) => { st.to = e.target.value; draw(); });
  $("kw").addEventListener("input", (e) => { st.q = e.target.value.trim(); draw(); });
  $("reset").addEventListener("click", () => {
    Object.assign(st, { group: "all", form: "", from: "", to: "", q: "" });
    $("group").value = "all"; $("from").value = ""; $("to").value = ""; $("kw").value = "";
    store.set("filters", {}); forms(); draw();
  });
  $("all")?.addEventListener("click", async (e) => {
    e.target.disabled = true; e.target.textContent = "Loading…";
    try { lib = await api(`/company/${encodeURIComponent(key)}/filings?full=true`); render(root, { co, key }); } catch (err) { e.target.textContent = err.message; }
  });
  forms();
  draw();
}
