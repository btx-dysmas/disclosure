// Company timeline: reports, earnings, deals, capital raises, leadership changes and insider activity in date order.
import { api, date, esc, failure, loading, store } from "../lib.js";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export async function render(root, { co, key }) {
  const k = encodeURIComponent(key);
  root.innerHTML = loading("Building the timeline from the filing index");
  let d;
  try { d = await api(`/company/${k}/timeline`); } catch (e) { root.innerHTML = failure("Timeline unavailable", e); return; }
  let off = new Set(store.get("tl:off", ["insiders"]));

  root.innerHTML = `
    <section class="panel">
      <header><h2>Timeline</h2><span class="sub">${d.complete ? "Complete filing history" : "Most recent 1,000 filings"}, classified by form and 8-K item</span></header>
      <div class="toolbar" id="cats">${d.categories.map((c) => `<label class="chk"><input type="checkbox" data-c="${c.key}"> ${esc(c.label)} <span class="muted">${c.count}</span></label>`).join("")}</div>
      <div id="tl"></div>
    </section>`;
  root.querySelectorAll("#cats input").forEach((i) => {
    i.checked = !off.has(i.dataset.c);
    i.addEventListener("change", () => { i.checked ? off.delete(i.dataset.c) : off.add(i.dataset.c); store.set("tl:off", [...off]); draw(); });
  });

  function draw() {
    const ev = d.events.filter((e) => !off.has(e.category));
    const groups = [];
    for (const e of ev) {
      const m = e.date.slice(0, 7);
      if (!groups.length || groups[groups.length - 1].m !== m) groups.push({ m, items: [] });
      groups[groups.length - 1].items.push(e);
    }
    root.querySelector("#tl").innerHTML = groups.length ? `<div class="timeline">${groups.map((g) => `
      <div class="tm"><div class="tm-h">${MONTHS[+g.m.slice(5) - 1]} ${g.m.slice(0, 4)}</div>
        <ul>${g.items.map((e) => `<li class="c-${e.category}">
          <span class="d">${e.category === "insiders" ? "" : date(e.date).replace(/, \d{4}$/, "")}</span>
          <span class="dot"></span>
          <span class="t">${e.accession ? `<a href="#/c/${k}/read/${e.accession}">${esc(e.label)}</a>` : `<a href="#/c/${k}/insiders">${esc(e.label)}</a>`}
            ${e.detail.length ? `<span class="muted"> · ${e.detail.map(esc).join(" · ")}</span>` : ""}${e.period ? `<span class="muted"> · period ending ${date(e.period)}</span>` : ""}</span>
          <span class="form">${esc(e.form)}</span></li>`).join("")}</ul></div>`).join("")}</div>` : `<div class="empty">No events in the selected categories.</div>`;
  }
  draw();
}
