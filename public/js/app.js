// Router and the search box in the top bar.
import { $, api, esc, marketStatus, target } from "./lib.js";

const view = $("#view");

const routes = [
  [/^#?\/?$/, () => import("./views/home.js"), () => ({})],
  [/^#\/workspace$/, () => import("./views/workspace.js"), () => ({})],
  [/^#\/c\/([^/]+)(?:\/([a-z-]+))?(?:\/(.+))?$/, () => import("./views/company.js"), (m) => ({ key: decodeURIComponent(m[1]), tab: m[2] || "overview", arg: m[3] ? decodeURIComponent(m[3]) : null })],
];

let current = 0;
async function route() {
  const hash = location.hash || "#/";
  const token = ++current;
  for (const [re, load, params] of routes) {
    const m = hash.match(re);
    if (!m) continue;
    const mod = await load();
    if (token !== current) return;
    await mod.render(view, params(m));
    for (const a of document.querySelectorAll("[data-nav]")) a.classList.toggle("on", hash.startsWith(a.getAttribute("href")) && (a.dataset.nav !== "home" || hash === "#/" || hash === ""));
    return;
  }
  view.innerHTML = `<div class="empty">No page at ${esc(hash)}. <a href="#/">Back to the dashboard</a>.</div>`;
}
window.addEventListener("hashchange", () => route().then(() => window.scrollTo(0, 0)));
route();

// Market session in the top bar, refreshed every minute.
function session() {
  const s = marketStatus();
  const el = $("#session");
  el.className = `session${s.open ? " open" : ""}`;
  el.innerHTML = `<i></i>${esc(s.label)}`;
}
session();
setInterval(session, 60_000);

// Search box: suggestions as you type, Enter opens the top match.
const form = $("#omni"), input = $("#q"), box = $("#suggest");
let results = [], active = 0, timer = null, seq = 0;

function draw() {
  if (!input.value.trim()) { box.hidden = true; return; }
  box.hidden = false;
  box.innerHTML = results.length
    ? results.map((r, i) => `<a href="${target(r)}" class="${i === active ? "on" : ""}"><b>${esc(r.ticker || "—")}</b><span>${esc(r.name)}${r.kind === "filing" ? ` <small>filing ${esc(r.accession)}</small>` : ""}</span><small>${esc(r.exchange || "")}</small></a>`).join("")
    : `<div class="none">No company or filing matches “${esc(input.value.trim())}”.</div>`;
}

input.addEventListener("input", () => {
  clearTimeout(timer);
  const q = input.value.trim();
  if (!q) { results = []; draw(); return; }
  timer = setTimeout(async () => {
    const mine = ++seq;
    try { const r = await api(`/search?q=${encodeURIComponent(q)}`); if (mine === seq) { results = r; active = 0; draw(); } } catch { /* keep last results */ }
  }, 160);
});
input.addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    if (results.length) { active = (active + (e.key === "ArrowDown" ? 1 : results.length - 1)) % results.length; draw(); }
  } else if (e.key === "Escape") { box.hidden = true; }
});
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const q = input.value.trim();
  if (!q) return;
  let r = results[active];
  if (!r) { try { r = (await api(`/search?q=${encodeURIComponent(q)}`))[0]; } catch { r = null; } }
  if (r) { location.hash = target(r); input.value = ""; results = []; box.hidden = true; input.blur(); }
  else draw();
});
box.addEventListener("click", () => { box.hidden = true; input.value = ""; results = []; });
document.addEventListener("click", (e) => { if (!form.contains(e.target)) box.hidden = true; });
document.addEventListener("keydown", (e) => {
  if (e.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)) { e.preventDefault(); input.focus(); }
});
