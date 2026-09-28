// Router and the search box in the top bar.
import { $, api, esc, isDark, marketStatus, setTheme, target } from "./lib.js";

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

// Light and dark themes. Views redraw so charts pick up the new colors; the scroll position is kept.
const SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
const MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11z"/></svg>';
const themeBtn = $("#theme");
function drawThemeButton() {
  const dark = isDark();
  themeBtn.innerHTML = dark ? SUN : MOON;
  const label = dark ? "Switch to light mode" : "Switch to dark mode";
  themeBtn.title = label;
  themeBtn.setAttribute("aria-label", label);
}
themeBtn.addEventListener("click", () => setTheme(!isDark()));
window.addEventListener("themechange", async () => {
  drawThemeButton();
  const y = window.scrollY;
  await route();
  window.scrollTo(0, y);
});
drawThemeButton();

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
