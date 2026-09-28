// Company and filing suggestions for a search box: results as you type, arrow keys to move, Enter to open.
import { api, esc, target } from "./lib.js";

export function attachSuggest(form, input, box) {
  let results = [], active = 0, timer = null, seq = 0;

  const close = () => { box.hidden = true; };
  const draw = () => {
    if (!input.value.trim()) { close(); return; }
    box.hidden = false;
    box.innerHTML = results.length
      ? results.map((r, i) => `<a href="${target(r)}" class="${i === active ? "on" : ""}"><b>${esc(r.ticker || "—")}</b><span>${esc(r.name)}${r.kind === "filing" ? ` <small>filing ${esc(r.accession)}</small>` : ""}</span><small>${esc(r.exchange || "")}</small></a>`).join("")
      : `<div class="none">No company or filing matches “${esc(input.value.trim())}”.</div>`;
  };
  const reset = () => { input.value = ""; results = []; close(); };

  input.setAttribute("autocomplete", "off");
  input.addEventListener("input", () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (!q) { results = []; draw(); return; }
    timer = setTimeout(async () => {
      const mine = ++seq;
      try { const r = await api(`/search?q=${encodeURIComponent(q)}`); if (mine === seq) { results = r; active = 0; draw(); } } catch { /* keep the last results */ }
    }, 160);
  });
  input.addEventListener("focus", () => { if (results.length) draw(); });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (results.length) { active = (active + (e.key === "ArrowDown" ? 1 : results.length - 1)) % results.length; draw(); }
    } else if (e.key === "Escape") close();
  });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (!q) return;
    let r = results[active];
    if (!r) { try { r = (await api(`/search?q=${encodeURIComponent(q)}`))[0]; } catch { r = null; } }
    if (r) { location.hash = target(r); reset(); input.blur(); }
    else { results = []; draw(); }
  });
  box.addEventListener("click", reset);
  // One document listener per box; it removes itself once the page has replaced the box.
  const outside = (e) => {
    if (!form.isConnected) { document.removeEventListener("click", outside); return; }
    if (!form.contains(e.target)) close();
  };
  document.addEventListener("click", outside);
}
