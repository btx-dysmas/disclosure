// Workspace: watchlist, saved filings, company notes and research ideas, all kept in this browser.
import { date, esc, store } from "../lib.js";
import { titleCase } from "./company.js";

const STAGES = ["Idea", "Researching", "Watching", "Closed"];

export async function render(root) {
  document.title = "Workspace · Disclosure";
  const draw = () => {
    const watch = store.get("watch", []);
    const saved = store.get("filings", []);
    const ideas = store.get("ideas", []);
    const notes = noteKeys().map((k) => ({ ...store.get(k, {}), key: k })).filter((n) => n.text?.trim());
    root.innerHTML = `
      <div class="ws-head"><h1 class="page-title">Workspace</h1>
        <span class="muted">Stored in this browser only. Export a copy to move it to another computer.</span>
        <span class="right"><button class="btn small" id="export">Export</button><label class="btn small">Import<input type="file" id="import" accept="application/json" hidden></label></span></div>
      <div class="cols c2">
        <section class="panel">
          <header><h2>Watchlist</h2><span class="sub">${watch.length}</span></header>
          ${watch.length ? `<table class="grid"><thead><tr><th>Ticker</th><th>Company</th><th class="r">Added</th><th></th></tr></thead><tbody>
            ${watch.map((c, i) => `<tr><td class="form"><a href="#/c/${encodeURIComponent(c.ticker || c.cik)}">${esc(c.ticker || c.cik)}</a></td><td>${esc(titleCase(c.name))}</td><td class="r">${date(c.added)}</td>
              <td class="r"><button class="link-btn" data-rm-watch="${i}">Remove</button></td></tr>`).join("")}</tbody></table>`
            : `<div class="empty">Add companies from their page with “Add to watchlist”.</div>`}
        </section>
        <section class="panel">
          <header><h2>Saved filings</h2><span class="sub">${saved.length}</span></header>
          ${saved.length ? `<table class="grid"><thead><tr><th>Form</th><th>Company</th><th class="r">Filed</th><th></th></tr></thead><tbody>
            ${saved.map((f, i) => `<tr><td class="form">${esc(f.form)}</td><td><a href="#/c/${encodeURIComponent(f.ticker || f.cik)}/read/${f.accession}">${esc(titleCase(f.company))}</a></td><td class="r">${date(f.filed)}</td>
              <td class="r"><button class="link-btn" data-rm-filing="${i}">Remove</button></td></tr>`).join("")}</tbody></table>`
            : `<div class="empty">Use “Save filing” in the reader to keep a filing here.</div>`}
        </section>
      </div>
      <section class="panel">
        <header><h2>Research ideas</h2><span class="sub">${ideas.length}</span></header>
        <form class="toolbar" id="idea">
          <input class="field" name="ticker" placeholder="Ticker" style="width:90px" aria-label="Ticker">
          <input class="field" name="title" placeholder="Idea, e.g. Azure margins peak as AI capex ramps" style="flex:1; min-width:220px" aria-label="Idea" required>
          <select class="field" name="stage" aria-label="Stage">${STAGES.map((s) => `<option>${s}</option>`).join("")}</select>
          <button class="btn primary">Add idea</button>
        </form>
        ${ideas.length ? `<table class="grid ideas"><thead><tr><th>Ticker</th><th>Idea</th><th>Thesis and evidence</th><th>Stage</th><th class="r">Updated</th><th></th></tr></thead><tbody>
          ${ideas.map((d, i) => `<tr>
            <td class="form">${d.ticker ? `<a href="#/c/${encodeURIComponent(d.ticker)}">${esc(d.ticker)}</a>` : "—"}</td>
            <td>${esc(d.title)}</td>
            <td><textarea class="field" rows="2" data-thesis="${i}" placeholder="What would prove it right or wrong, and which filing to check">${esc(d.thesis || "")}</textarea></td>
            <td><select class="field" data-stage="${i}">${STAGES.map((s) => `<option ${s === d.stage ? "selected" : ""}>${s}</option>`).join("")}</select></td>
            <td class="r">${date(d.updated)}</td>
            <td class="r"><button class="link-btn" data-rm-idea="${i}">Delete</button></td></tr>`).join("")}</tbody></table>`
          : `<div class="empty">Track a thesis and what would change your mind.</div>`}
      </section>
      <section class="panel">
        <header><h2>Company notes</h2><span class="sub">Written on each company's overview page</span></header>
        ${notes.length ? notes.map((n) => `<div class="note-row"><a href="#/c/${encodeURIComponent(n.ticker || n.cik)}">${esc(n.ticker || n.cik)} · ${esc(titleCase(n.name || ""))}</a><span class="muted"> · ${date(n.updated)}</span><p>${esc(n.text)}</p></div>`).join("")
          : `<div class="empty">No notes yet.</div>`}
      </section>`;

    const today = () => new Date().toISOString().slice(0, 10);
    root.querySelectorAll("[data-rm-watch]").forEach((b) => b.addEventListener("click", () => { const l = store.get("watch", []); l.splice(+b.dataset.rmWatch, 1); store.set("watch", l); draw(); }));
    root.querySelectorAll("[data-rm-filing]").forEach((b) => b.addEventListener("click", () => { const l = store.get("filings", []); l.splice(+b.dataset.rmFiling, 1); store.set("filings", l); draw(); }));
    root.querySelectorAll("[data-rm-idea]").forEach((b) => b.addEventListener("click", () => { const l = store.get("ideas", []); l.splice(+b.dataset.rmIdea, 1); store.set("ideas", l); draw(); }));
    root.querySelectorAll("[data-thesis]").forEach((t) => t.addEventListener("change", () => { const l = store.get("ideas", []); Object.assign(l[+t.dataset.thesis], { thesis: t.value, updated: today() }); store.set("ideas", l); }));
    root.querySelectorAll("[data-stage]").forEach((s) => s.addEventListener("change", () => { const l = store.get("ideas", []); Object.assign(l[+s.dataset.stage], { stage: s.value, updated: today() }); store.set("ideas", l); draw(); }));
    root.querySelector("#idea").addEventListener("submit", (e) => {
      e.preventDefault();
      const f = e.target;
      const l = store.get("ideas", []);
      l.unshift({ ticker: f.ticker.value.trim().toUpperCase(), title: f.title.value.trim(), stage: f.stage.value, thesis: "", updated: today() });
      store.set("ideas", l);
      draw();
    });
    root.querySelector("#export").addEventListener("click", () => {
      const data = { exported: new Date().toISOString(), watch: store.get("watch", []), filings: store.get("filings", []), ideas: store.get("ideas", []), notes: Object.fromEntries(noteKeys().map((k) => [k, store.get(k, {})])) };
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      a.download = `disclosure-workspace-${today()}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    });
    root.querySelector("#import").addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const d = JSON.parse(await file.text());
        for (const k of ["watch", "filings", "ideas"]) if (Array.isArray(d[k])) store.set(k, d[k]);
        for (const [k, v] of Object.entries(d.notes || {})) if (k.startsWith("note:")) store.set(k, v);
        draw();
      } catch { alert("That file is not a Disclosure workspace export."); }
    });
  };
  draw();
}

function noteKeys() {
  try { return Object.keys(localStorage).filter((k) => k.startsWith("disclosure:note:")).map((k) => k.slice("disclosure:".length)); } catch { return []; }
}
