const DATA = /*DATA*/null;
const ALL = DATA.projects;
let P = ALL; // everything still tracked; see applyHidden()
const byId = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const icon = n => `<svg class="i"><use href="#${n}"/></svg>`;
const ICONS = /*ICONS*/{};
const COLORS = ["blue", "green", "lilac", "amber", "rose", "grey"];
ALL.forEach((p, i) => { p.color = COLORS[i % COLORS.length]; });
const STATUS = { active: ["Active", "green"], quiet: ["Going quiet", "amber"], paused: ["Paused", "grey"], dormant: ["Older", "grey"] };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const state = { view: "", query: "", showOld: false, pins: [], pinNote: "", hidden: [], confirmStop: "", undo: null, showHidden: false };

// Pins live in the board's own database so they follow you between laptop and phone, and survive the daily refresh.
// Browser storage is only a fast first paint and the fallback when the database isn't available.
// Storage: the site's own API (functions/api on Cloudflare Pages, backed by KV). This small adapter offers the
// same doc/collection calls the page already uses. Opened as a plain file, apiDb() is null and the page falls back
// to this browser's storage.
let apiDbPromise = null;
function apiDb() {
  return apiDbPromise ||= (async () => {
    if (location.protocol === "file:" || location.origin === "null") return null;
    try { const r = await fetch("/api/health", { credentials: "same-origin" }); if (!r.ok) return null; } catch (e) { return null; }
    const call = async (method, path, body) => {
      const r = await fetch("/api/" + path, { method, credentials: "same-origin", headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
      if (!r.ok) throw new Error(method + " " + path + " " + r.status);
      return r.status === 204 ? null : r.json();
    };
    const refreshers = new Set();
    const refreshAll = () => refreshers.forEach(f => f());
    document.addEventListener("visibilitychange", () => { if (!document.hidden) refreshAll(); });
    window.addEventListener("focus", refreshAll);
    const doc = path => ({
      async set(body) { await call("PUT", "doc/" + path, body); },
      onSnapshot(next, err) {
        const f = () => call("GET", "doc/" + path).then(b => next({ exists: !!b, data: () => b }), e => err && err(e));
        refreshers.add(f); f(); return () => refreshers.delete(f);
      },
    });
    const collection = name => {
      const listeners = new Set();
      const load = () => call("GET", "col/" + name).then(list => {
        const snap = { docs: list.map(({ id, ...d }) => ({ id, data: () => d })), size: list.length };
        listeners.forEach(l => l(snap));
      }, () => {});
      const col = {
        orderBy() { return col; }, limit() { return col; },
        onSnapshot(next) { listeners.add(next); refreshers.add(load); load(); return () => listeners.delete(next); },
        async add(data) { const r = await call("POST", "col/" + name, data); load(); return { id: r.id }; },
        doc(id) { return {
          async set(body) { await call("PUT", `col/${name}/${encodeURIComponent(id)}`, body); load(); },
          async delete() { await call("DELETE", `col/${name}/${encodeURIComponent(id)}`); load(); },
        }; },
      };
      return col;
    };
    return { doc, collection };
  })();
}
let pinDoc = null;
try { state.pins = JSON.parse(localStorage.getItem("dashboard-pins") || "[]"); } catch (e) {}
const isPinned = p => state.pins.includes(p.id);
function cachePins() { try { localStorage.setItem("dashboard-pins", JSON.stringify(state.pins)); } catch (e) {} }
async function togglePin(id) {
  const before = state.pins;
  state.pins = before.includes(id) ? before.filter(x => x !== id) : [...before, id];
  cachePins(); render();
  if (!pinDoc) return;
  try { await pinDoc.set({ ids: state.pins }); }
  catch (e) { state.pinNote = "Pins are saved on this device only right now."; render(); }
}
(async () => {
  const db = await apiDb();
  if (!db) return;
  pinDoc = db.doc("board/pins");
  pinDoc.onSnapshot(snap => {
    const ids = snap.exists && Array.isArray(snap.data().ids) ? snap.data().ids.filter(x => typeof x === "string") : null;
    if (ids) { state.pins = ids; cachePins(); render(); }
    else if (state.pins.length) pinDoc.set({ ids: state.pins }).catch(() => {}); // first run: keep pins made before the database answered
  }, () => {});
})();
// Projects you stop tracking: kept as {id, name} in the board's database ("board/hidden"). The page hides them at once,
// and the daily refresh reads the same list so the scanner leaves them out. Nothing on disk is touched.
let hiddenDoc = null;
try { state.hidden = JSON.parse(localStorage.getItem("dashboard-hidden") || "[]"); } catch (e) {}
function applyHidden() { const ids = state.hidden.map(h => h.id); P = ALL.filter(p => !ids.includes(p.id)); }
applyHidden();
async function saveHidden() {
  try { localStorage.setItem("dashboard-hidden", JSON.stringify(state.hidden)); } catch (e) {}
  applyHidden(); render();
  if (hiddenDoc) await hiddenDoc.set({ items: state.hidden }).catch(() => { state.pinNote = "Changes are saved on this device only right now."; render(); });
}
function stopTracking(id) {
  const p = ALL.find(x => x.id === id); if (!p) return;
  state.hidden = [...state.hidden.filter(h => h.id !== id), { id, name: p.name }];
  state.confirmStop = ""; state.undo = { id, name: p.name };
  if (isPinned(p)) togglePin(id);
  state.view = ""; try { history.replaceState(null, "", location.pathname); } catch (e) {}
  saveHidden();
}
function restoreTracking(id) { state.hidden = state.hidden.filter(h => h.id !== id); state.undo = null; saveHidden(); }
(async () => {
  const db = await apiDb();
  if (!db) return;
  hiddenDoc = db.doc("board/hidden");
  hiddenDoc.onSnapshot(snap => {
    const items = snap.exists && Array.isArray(snap.data().items) ? snap.data().items.filter(h => h && typeof h.id === "string") : null;
    if (items) { state.hidden = items.map(h => ({ id: h.id, name: String(h.name || h.id) })); try { localStorage.setItem("dashboard-hidden", JSON.stringify(state.hidden)); } catch (e) {} applyHidden(); render(); }
    else if (state.hidden.length) hiddenDoc.set({ items: state.hidden }).catch(() => {});
  }, () => {});
})();
const pinBtn = (p, cls = "") => `<button class="pin ${isPinned(p) ? "on" : ""} ${cls}" data-pin="${p.id}" aria-pressed="${isPinned(p)}" aria-label="${isPinned(p) ? "Unpin" : "Pin"} ${esc(p.name)}" title="${isPinned(p) ? "Unpin" : "Pin to top"}"><svg class="i"><use href="#pin"/></svg></button>`;
const today = new Date(); today.setHours(0, 0, 0, 0);

function dayDiff(iso) { const d = new Date(iso); d.setHours(0, 0, 0, 0); return Math.round((today - d) / 864e5); }
function ago(iso) {
  if (!iso) return "No activity";
  const n = dayDiff(iso);
  if (n <= 0) return "Today";
  if (n === 1) return "Yesterday";
  if (n < 45) return `${n} days ago`;
  return `${Math.round(n / 30)} months ago`;
}
function fmtDate(iso, year) { const d = new Date(iso); return `${MONTHS[d.getMonth()]} ${d.getDate()}${year ? ", " + d.getFullYear() : ""}`; }
function time(iso) { return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); }
function pill(status, blocked) { const [t, c] = blocked ? ["Blocked", "rose"] : STATUS[status]; return `<span class="pill ${c}">${t}</span>`; }
function go(view) { state.view = view; try { history.replaceState(null, "", view ? "#" + view : location.pathname); } catch (e) {} byId("side").classList.remove("open"); render(); window.scrollTo(0, 0); }

// A letter tile per project: the first letters of its first two words, tinted with the project's color.
function initials(name) { const w = name.split(/[\s\-_]+/).filter(Boolean); return (w.length > 1 ? w[0][0] + w[1][0] : w[0].slice(0, 1)).toUpperCase(); }
const tile = (p, cls = "") => `<span class="tile t-${p.color} ${cls}" aria-hidden="true">${esc(initials(p.name))}</span>`;
function shortAgo(iso) {
  if (!iso) return "";
  const n = dayDiff(iso);
  return n <= 0 ? "Today" : n < 7 ? `${n}d` : n < 45 ? `${Math.round(n / 7)}w` : `${Math.round(n / 30)}mo`;
}
const sideLink = p => `<a data-go="${p.id}" class="${state.view === p.id ? "on" : ""}">${tile(p)}<span class="nm">${esc(p.name)}</span><span class="ago">${shortAgo(p.last)}</span></a>`;

function sidebar() {
  const group = (title, list) => list.length ? `<div><h4>${title}</h4><div class="plist">${list.map(p =>
    sideLink(p)).join("")}</div></div>` : "";
  const pinned = state.pins.map(id => P.find(p => p.id === id)).filter(Boolean);
  const rest = P.filter(p => !isPinned(p));
  const active = rest.filter(p => p.status === "active"), quiet = rest.filter(p => p.status === "quiet" || p.status === "paused"), old = rest.filter(p => p.status === "dormant");
  byId("side").innerHTML = `
    <button class="close icon-btn" data-menu aria-label="Close menu">${icon("x")}</button>
    <div class="logo"><b><i></i></b>Dashboard</div>
    <nav class="nav">
      <a data-go="" class="${state.view === "" ? "on" : ""}">${icon("grid")}Today</a>
      <a data-go="services" class="${state.view === "services" ? "on" : ""}">${icon("layers")}Services<span class="count">${new Set(P.flatMap(p => p.services.map(s => s.name))).size}</span></a>
    </nav>
    <hr>
    ${group("Pinned", pinned)}${group("Active", active)}${group("Going quiet", quiet)}
    ${old.length ? `<div><h4>Older</h4><div class="plist">${old.map(sideLink).join("")}</div></div>` : ""}
    <div class="foot"><span class="dot-live"></span>Scanned your Mac ${ago(DATA.generated).toLowerCase()} at ${time(DATA.generated)}</div>`;
}

function matches(p) {
  const q = state.query; if (!q) return true;
  return [p.name, p.next, p.blocked, p.description, ...p.stack, ...p.services.map(s => s.name)].join(" ").toLowerCase().includes(q);
}

function todayView() {
  const h = new Date().getHours();
  const hello = h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  const d = new Date();
  const active = P.filter(p => p.status === "active").length, quiet = P.filter(p => p.status === "quiet").length;
  const dirty = P.reduce((n, p) => n + p.dirty, 0);
  const pinned = state.pins.map(id => P.find(p => p.id === id)).filter(p => p && matches(p));
  const main = P.filter(p => !isPinned(p) && p.status !== "dormant" && matches(p)), old = P.filter(p => !isPinned(p) && p.status === "dormant" && matches(p));
  const rows = [...pinned, ...main, ...(state.showOld || state.query ? old : [])].map(p => {
    const last = p.commits[0]?.msg;
    const next = p.next ? `${esc(p.next)}${p.blocked ? `<span class="blk">Blocked: ${esc(p.blocked)}</span>` : ""}`
      : `<span class="muted">No next step yet</span>${last ? `<span class="last">Last commit: ${esc(last)}</span>` : p.description ? `<span class="last">${esc(p.description)}</span>` : ""}`;
    return `<tr class="rowlink ${isPinned(p) ? "pinned" : ""}" data-go="${p.id}" tabindex="0"><td><div class="pname">${tile(p)}${esc(p.name)}${pinBtn(p)}</div></td>
      <td class="next">${next}</td>
      <td><div class="meta"><span>${ago(p.last)}</span>${p.git ? `<span title="Uncommitted files">${icon("file")}${p.dirty}</span>` : ""}</div></td>
      <td>${pill(p.status, p.blocked)}</td></tr>`;
  }).join("");

  // This week, Monday to Sunday, across every project.
  const monday = new Date(today); monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  const week = P.flatMap(p => p.week.map(c => ({ ...c, project: p }))).sort((a, b) => b.when.localeCompare(a.when));
  const perDay = [...Array(7)].map((_, i) => { const day = new Date(monday); day.setDate(monday.getDate() + i);
    return { day, n: week.filter(c => { const w = new Date(c.when); w.setHours(0, 0, 0, 0); return +w === +day; }).length }; });
  const maxN = Math.max(1, ...perDay.map(x => x.n));

  return `
    <div class="hello"><div><div class="date">${d.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" })}</div><h1>${hello}, Yashwanth</h1></div></div>
    <div><div class="stats">
      <div class="stat">${icon("bolt")}<b>${active}</b>active</div>
      <div class="stat warn">${icon("moon")}<b>${quiet}</b>going quiet</div>
      <div class="stat">${icon("file")}<b>${dirty}</b>uncommitted files</div>
    </div></div>
    <section class="card">
      <div class="card-h">${icon("list")}<h2>My projects</h2><span class="grow"></span><span class="hint">${state.pinNote || (state.pins.length ? `${state.pins.length} pinned` : "Pin a project to keep it on top")}</span></div>
      ${state.undo ? `<div class="undo" role="status">Stopped tracking ${esc(state.undo.name)}.<button data-restore="${esc(state.undo.id)}">Undo</button></div>` : ""}
      ${rows ? `<table class="tbl"><thead><tr><th>${icon("folder")}Project</th><th>${icon("target")}Next step</th><th>${icon("clock")}Last change</th><th>${icon("status")}Status</th></tr></thead><tbody>${rows}</tbody></table>`
        : `<div class="empty"><b>No projects match “${esc(state.query)}”</b>Try a service like Stripe, a stack like Next.js, or clear the search.</div>`}
      ${!state.query && old.length ? `<div class="showmore"><button data-old>${state.showOld ? "Hide older projects" : `Show ${old.length} older projects`}</button></div>` : ""}
      ${state.hidden.length ? `<div class="untracked"><button data-hidden-toggle aria-expanded="${state.showHidden}">${state.hidden.length} ${state.hidden.length === 1 ? "project" : "projects"} not tracked${icon("chev")}</button>
        ${state.showHidden ? `<div class="untracked-list">${state.hidden.map(h => `<div><span>${esc(h.name)}</span><button class="btn sm" data-restore="${esc(h.id)}">Track again</button></div>`).join("")}</div>` : ""}</div>` : ""}
    </section>
    <div class="duo">
      <section class="card">
        <div class="card-h">${icon("cal")}<h2>This week</h2></div>
        <div class="week">${perDay.map(({ day, n }) => `<div class="wd ${+day === +today ? "on" : ""}">${day.toLocaleDateString([], { weekday: "short" }).slice(0, 2)}<b>${day.getDate()}</b><span class="bars">${n ? `<i style="height:${Math.max(3, n / maxN * 14)}px"></i>` : `<i class="z"></i>`}</span></div>`).join("")}</div>
        ${week.length ? week.slice(0, 5).map(c => `<a class="ev" data-go="${c.project.id}"><span class="bar" style="background:var(--${c.project.color === "grey" ? "line-2" : c.project.color === "lilac" ? "lilac-ink" : c.project.color})"></span><div><div class="t">${icon("commit")}${esc(c.msg)}</div><div class="s">${esc(c.project.name)}, ${dayDiff(c.when) === 0 ? time(c.when) : ago(c.when).toLowerCase()}</div></div><span class="n">+${c.add} −${c.del}</span></a>`).join("")
          : `<div class="empty"><b>No commits yet this week</b>Commits from every project show up here.</div>`}
      </section>
      ${ideasCard(null)}
    </div>`;
}

function servicesCard(p) {
  const groups = {};
  p.services.forEach(s => { (groups[s.category] ||= []).push(s); });
  const exp = p.expires ? Math.round((new Date(p.expires) - today) / 864e5) : null;
  const sum = `<div class="svc-sum"><div><b>${p.services.length}</b>${p.services.length === 1 ? "service" : "services"}</div>
    ${exp !== null ? `<div class="${exp < 60 ? "warn" : ""}"><b>${exp} days</b>until ${esc(p.domain)} renews</div>` : ""}</div>`;
  const row = s => {
    const warn = s.expires && Math.round((new Date(s.expires) - today) / 864e5) < 60;
    return `<div class="srv"><span class="logo-t">${ICONS[s.name] ? logo(s.name) : esc(s.name[0])}</span>
      <div class="sv-main"><div class="sv-name">${esc(s.name)}<span class="src">${esc(s.source)}</span></div><div class="sv-what">${esc(s.what)}</div>${s.keys.length ? `<div class="svc-keys">Settings: ${s.keys.map(k => `<code>${esc(k)}</code>`).join(" ")}</div>` : ""}</div>
      <div class="sv-acct">${s.account ? esc(s.account) : `<i class="ask">Not recorded</i>`}</div>
      ${s.url ? `<a class="sv-open ${warn ? "warnlink" : ""}" href="${esc(s.url)}" target="_blank" rel="noopener">${warn ? "Renew domain" : "Open"}${icon("ext")}</a>` : `<span class="sv-open none"></span>`}</div>`;
  };
  return `<section class="card">
    <div class="card-h">${icon("layers")}<h2>Services and accounts</h2></div>
    ${p.services.length ? sum + Object.entries(groups).map(([g, list]) => `<div class="grp">${esc(g)}</div>${list.map(row).join("")}`).join("")
      + `<div class="empty hint">Which login, plan and cost each service uses can't be read from code. Tell Claude in this project, for example “${esc(p.name)}'s ${esc(p.services[0].name)} is on my Gmail, free plan”, and it's saved to <code>PROJECT.md</code>.</div>`
      : `<div class="empty"><b>No outside services found</b>Nothing in the code, settings or DNS points to a hosted service. Add one to the <code>## Accounts</code> list in <code>PROJECT.md</code>.</div>`}
  </section>`;
}

// Main stack only: the pieces that define the project, one per layer that matters. Tests, linters and helper libraries stay out.
const MAIN_LAYERS = ["App", "Language", "Styling", "Backend", "Data", "AI and ML", "Automation", "Hosting and deploy"];
const MINOR = /^(React \d+|React|Uvicorn|Zod|Coil|CameraX|Radix UI|GitHub Actions|NextAuth)$/;
// Brand marks from Simple Icons, drawn in the text color so they sit quietly in both themes. No mark: the first letter.
function logo(name) {
  const d = ICONS[name] || ICONS[name.replace(/ [\d.]+$/, "")];
  return d ? `<svg class="lg-i" viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>` : `<span class="lg-i lg-x" aria-hidden="true">${esc(name[0])}</span>`;
}
function builtCard(p) {
  const main = MAIN_LAYERS.flatMap(l => (p.built.find(b => b.layer === l)?.items || [])
    .filter(i => !MINOR.test(i.name)).slice(0, 2).map(i => ({ layer: l, name: i.name })));
  if (!main.length) return "";
  return `<section class="card stack-card">
    <div class="card-h">${icon("grid")}<h2>Main stack</h2></div>
    <div class="stack">${main.map(i => `<div class="st">${logo(i.name)}<div><span>${esc(i.layer === "Hosting and deploy" ? "Hosting" : i.layer)}</span><b>${esc(i.name)}</b></div></div>`).join("")}</div>
  </section>`;
}

function projectView(p) {
  const mx = Math.max(1, ...p.activity);
  return `
    <div class="crumb"><a data-go="">Today</a>${icon("right")}${esc(p.name)}</div>
    <div class="ph"><div>
      <h1>${tile(p, "lg")}${esc(p.name)} ${pill(p.status, p.blocked)}</h1>
      <div class="sub">${p.domain ? `<a href="https://${esc(p.domain)}" target="_blank" rel="noopener">${icon("globe")}${esc(p.domain)}${icon("ext")}</a>` : ""}<span>Last change ${ago(p.last).toLowerCase()}</span>${p.first ? `<span>Started ${fmtDate(p.first, true)}</span>` : ""}</div>
      ${p.description ? `<p class="hint" style="margin-top:8px;max-width:70ch">${esc(p.description)}</p>` : ""}
    </div><div class="ph-actions"><button class="btn pin-btn ${isPinned(p) ? "on" : ""}" data-pin="${p.id}" aria-pressed="${isPinned(p)}"><svg class="i"><use href="#pin"/></svg>${isPinned(p) ? "Pinned" : "Pin to top"}</button>
      <button class="btn danger-ghost" data-stop="${p.id}">${icon("eyeoff")}Stop tracking</button></div></div>
    ${state.confirmStop === p.id ? `<div class="confirm" role="alertdialog" aria-labelledby="stopQ">
      <div><b id="stopQ">Stop tracking ${esc(p.name)}?</b><p>It disappears from the dashboard, and the daily scan skips it from now on. Your folder <code>${esc(p.folder)}</code> and its files stay exactly as they are. You can track it again from the Today page.</p></div>
      <div class="confirm-actions"><button class="btn" data-stop-no>Cancel</button><button class="btn danger" id="stopYes" data-stop-yes="${p.id}">Stop tracking</button></div></div>` : ""}
    ${builtCard(p)}
    ${servicesCard(p)}
    ${ideasCard(p)}
    <div class="tri solo">
      <section class="card">
        <div class="card-h">${icon("commit")}<h2>Commits, last 14 days</h2></div>
        ${p.git ? `<div class="chart"><div class="cols">${p.activity.map(n => n ? `<i style="height:${n / mx * 100}%" title="${n} commits"></i>` : `<i class="z"></i>`).join("")}</div><div class="ax"><span>2 weeks ago</span><span>Today</span></div></div>
        <div class="commits" style="border-top:1px solid var(--line)">${p.commits.slice(0, 4).map(c => `<div class="cm"><time>${ago(c.when).replace(" ago", "")}</time><span class="nd"></span><div class="msg">${esc(c.msg)}<small>${c.files} files, +${c.add} −${c.del}</small></div></div>`).join("")}</div>`
          : `<div class="empty"><b>No git history</b>Run <code>git init</code> in this folder to see commits here.</div>`}
      </section>
    </div>
    <section class="card">
      <div class="card-h">${icon("note")}<h2>Decisions</h2></div>
      ${p.open.length || p.decisions.length ? p.open.map(q => `<div class="todo"><span class="circ"></span><div><div class="t">${esc(q)}</div><div class="s">Open</div></div></div>`).join("")
        + p.decisions.map(dc => `<div class="todo done"><span class="circ done">${icon("check")}</span><div><div class="t">${esc(dc)}</div></div></div>`).join("")
        : `<div class="empty"><b>No decisions recorded</b>When you settle something (“Resend over SES because…”), tell Claude to note it. It's saved to <code>PROJECT.md</code> and listed here.</div>`}
    </section>`;
}

function servicesView() {
  const map = {};
  P.forEach(p => p.services.forEach(s => { (map[s.name] ||= { s, users: [] }).users.push(p); }));
  const list = Object.values(map).filter(({ s, users }) => !state.query || (s.name + users.map(u => u.name).join(" ")).toLowerCase().includes(state.query))
    .sort((a, b) => b.users.length - a.users.length || a.s.name.localeCompare(b.s.name));
  return `<div class="hello"><div><div class="date">Across ${P.length} projects</div><h1>Services</h1></div></div>
    <section class="card svc-index">
      <div class="card-h">${icon("layers")}<h2>Who uses what</h2><span class="grow"></span><span class="hint">${list.length} services</span></div>
      ${list.map(({ s, users }) => `<div class="srv"><span class="logo-t">${ICONS[s.name] ? logo(s.name) : esc(s.name[0])}</span>
        <div class="sv-main"><div class="sv-name">${esc(s.name)}</div><div class="sv-what">${esc(s.category)}</div></div>
        <div class="users">${users.map(u => `<a class="tag" data-go="${u.id}">${esc(u.name)}</a>`).join("")}</div>
        ${s.url && !/jiffkit|github\.com\/|godaddy\.com\/control/.test(s.url) ? `<a class="sv-open" href="${esc(s.url)}" target="_blank" rel="noopener">Open${icon("ext")}</a>` : `<span class="sv-open none"></span>`}</div>`).join("")
        || `<div class="empty"><b>No services match “${esc(state.query)}”</b>Clear the search to see all of them.</div>`}
    </section>`;
}

// Ideas: captured in seconds from anywhere on the board. One document per idea in the "ideas" collection, so they
// sync between phone and laptop, survive the daily refresh, and Claude can read them later.
state.ideas = []; state.capture = null; state.showDone = false; state.toast = null;
let ideasCol = null;
function loadLocalIdeas() { try { state.ideas = JSON.parse(localStorage.getItem("dashboard-ideas") || "[]"); } catch (e) {} }
function saveLocalIdeas() { if (ideasCol) return; try { localStorage.setItem("dashboard-ideas", JSON.stringify(state.ideas)); } catch (e) {} }
loadLocalIdeas();
(async () => {
  const db = await apiDb();
  if (!db) return;
  ideasCol = db.collection("ideas");
  ideasCol.orderBy("createdAt", "desc").limit(300).onSnapshot(snap => {
    state.ideas = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(i => typeof i.text === "string");
    render();
  }, () => {});
})();
function toast(msg, undo) {
  clearTimeout(toast.t);
  state.toast = { msg, undo };
  renderOverlay();
  toast.t = setTimeout(() => { state.toast = null; renderOverlay(); }, undo ? 6000 : 2200);
}
async function addIdea(text, projectId) {
  const p = ALL.find(x => x.id === projectId);
  const idea = { text, project: p ? p.id : "", projectName: p ? p.name : "", createdAt: new Date().toISOString(), done: false };
  if (ideasCol) {
    try { await ideasCol.add(idea); toast("Idea saved"); }
    catch (e) { toast("Couldn't save the idea. Copy it somewhere, then try again."); return false; }
  } else { state.ideas = [{ id: "l" + Date.now(), ...idea }, ...state.ideas]; saveLocalIdeas(); render(); toast("Idea saved"); }
  return true;
}
async function setIdea(id, patch) {
  const i = state.ideas.find(x => x.id === id); if (!i) return;
  Object.assign(i, patch); render();
  if (ideasCol) { const { id: _, ...body } = i; await ideasCol.doc(id).set(body).catch(() => toast("Couldn't update the idea.")); }
  else saveLocalIdeas();
}
async function deleteIdea(id) {
  const i = state.ideas.find(x => x.id === id); if (!i) return;
  state.ideas = state.ideas.filter(x => x.id !== id); render();
  if (ideasCol) await ideasCol.doc(id).delete().catch(() => toast("Couldn't delete the idea."));
  else saveLocalIdeas();
  toast("Idea deleted", () => restoreIdea(i));
}
async function restoreIdea(i) {
  const { id, ...body } = i;
  if (ideasCol) await ideasCol.doc(id).set(body).catch(() => {});
  else { state.ideas = [i, ...state.ideas]; saveLocalIdeas(); }
  state.toast = null; render(); renderOverlay();
}

function ideaRow(i, showProject) {
  return `<div class="idea ${i.done ? "done" : ""}">
    <button class="circ ${i.done ? "done" : ""}" data-idea-done="${esc(i.id)}" aria-label="${i.done ? "Mark as not done" : "Mark as done"}">${i.done ? icon("check") : ""}</button>
    <div class="idea-b"><div class="idea-t">${esc(i.text)}</div>
      <div class="idea-m">${showProject ? (i.project ? `<a class="itag" data-go="${esc(i.project)}">${esc(i.projectName || i.project)}</a>` : `<span class="itag new">New project</span>`) : ""}<span>${ago(i.createdAt)}</span></div></div>
    <button class="idea-x" data-idea-del="${esc(i.id)}" aria-label="Delete idea">${icon("trash")}</button>
  </div>`;
}
function ideasCard(p) {
  const mine = state.ideas.filter(i => !p || i.project === p.id);
  const open = mine.filter(i => !i.done), done = mine.filter(i => i.done);
  const list = [...open, ...(state.showDone ? done : [])];
  return `<section class="card ideas-card">
    <div class="card-h">${icon("bulb")}<h2>${p ? "Ideas" : "Ideas"}</h2><span class="grow"></span><button class="link" data-capture="${p ? p.id : ""}">${icon("plus")}Add</button></div>
    ${list.length ? list.slice(0, p ? 50 : 8).map(i => ideaRow(i, !p)).join("") : `<div class="empty"><b>${p ? `No ideas for ${esc(p.name)} yet` : "No ideas yet"}</b>When one hits, tap <b class="inline">Capture idea</b>${p ? "" : " (the + button on your phone)"}, type it and press Enter. It takes a few seconds.</div>`}
    ${!p && open.length > 8 ? `<div class="showmore"><span class="hint">${open.length - 8} more open ideas</span></div>` : ""}
    ${done.length ? `<div class="showmore"><button data-show-done>${state.showDone ? "Hide done" : `Show ${done.length} done`}</button></div>` : ""}
  </section>`;
}

function renderOverlay() {
  const root = byId("overlay"); if (!root) return;
  const c = state.capture;
  const targets = [...state.pins.map(id => P.find(p => p.id === id)).filter(Boolean), ...P.filter(p => !isPinned(p) && p.status !== "dormant"), ...P.filter(p => !isPinned(p) && p.status === "dormant")];
  root.innerHTML = (c ? `<div class="cap-scrim" data-capture-close></div>
    <div class="cap" role="dialog" aria-modal="true" aria-labelledby="capH">
      <div class="cap-h"><h2 id="capH">Capture idea</h2><button class="x" data-capture-close aria-label="Close">${icon("x")}</button></div>
      <textarea id="ideaText" rows="3" placeholder="Add a dark mode toggle to jiffkit's settings" aria-label="Your idea">${esc(c.text)}</textarea>
      <div class="cap-l">For</div>
      <div class="cap-t" role="radiogroup" aria-label="Project">
        <button role="radio" aria-checked="${!c.project}" data-target="">${icon("bulb")}New project idea</button>
        ${targets.map(p => `<button role="radio" aria-checked="${c.project === p.id}" data-target="${p.id}">${tile(p)}${esc(p.name)}</button>`).join("")}
      </div>
      <div class="cap-f"><span class="hint">Enter saves. Shift+Enter adds a line.</span><button class="btn primary" data-capture-save>Save idea</button></div>
    </div>` : "")
    + (state.toast ? `<div class="toast" role="status">${esc(state.toast.msg)}${state.toast.undo ? `<button data-toast-undo>Undo</button>` : ""}</div>` : "");
  if (c) { const t = byId("ideaText"); t.focus(); t.setSelectionRange(t.value.length, t.value.length); }
}
function openCapture(project) { state.capture = { text: "", project: project ?? (P.some(p => p.id === state.view) ? state.view : "") }; renderOverlay(); }
async function saveCapture() {
  const text = (byId("ideaText")?.value || "").trim();
  if (!text) { byId("ideaText")?.focus(); return; }
  const c = state.capture; state.capture = null; renderOverlay();
  const ok = await addIdea(text, c.project);
  if (!ok) { state.capture = { ...c, text }; renderOverlay(); }
}

function render() {
  sidebar();
  const p = P.find(x => x.id === state.view);
  byId("view").innerHTML = p ? projectView(p) : state.view === "services" ? servicesView() : todayView();
  document.title = p ? `${p.name} · Dashboard` : "Dashboard";
}

document.addEventListener("click", e => {
  const pin = e.target.closest("[data-pin]");
  if (pin) { e.preventDefault(); e.stopPropagation(); togglePin(pin.dataset.pin); return; }
  const ask = e.target.closest("[data-stop]");
  if (ask) { state.confirmStop = ask.dataset.stop; render(); byId("stopYes")?.focus(); return; }
  if (e.target.closest("[data-stop-no]")) { state.confirmStop = ""; render(); return; }
  const yes = e.target.closest("[data-stop-yes]");
  if (yes) { stopTracking(yes.dataset.stopYes); return; }
  const back = e.target.closest("[data-restore]");
  if (back) { restoreTracking(back.dataset.restore); return; }
  const capBtn = e.target.closest("[data-capture]");
  if (capBtn) { e.preventDefault(); openCapture(capBtn.dataset.capture || null); return; }
  if (e.target.closest("[data-capture-close]")) { state.capture = null; renderOverlay(); return; }
  if (e.target.closest("[data-capture-save]")) { saveCapture(); return; }
  const tgt = e.target.closest("[data-target]");
  if (tgt && state.capture) { state.capture.text = byId("ideaText").value; state.capture.project = tgt.dataset.target; renderOverlay(); return; }
  const idd = e.target.closest("[data-idea-done]");
  if (idd) { const i = state.ideas.find(x => x.id === idd.dataset.ideaDone); if (i) setIdea(i.id, { done: !i.done }); return; }
  const idx = e.target.closest("[data-idea-del]");
  if (idx) { deleteIdea(idx.dataset.ideaDel); return; }
  if (e.target.closest("[data-show-done]")) { state.showDone = !state.showDone; render(); return; }
  if (e.target.closest("[data-toast-undo]")) { state.toast?.undo?.(); return; }
  const cp = e.target.closest("[data-copy]");
  if (cp) {
    const done = () => { const s = cp.querySelector("small"); const t = s.textContent; s.textContent = "Copied"; setTimeout(() => { s.textContent = t; }, 1200); };
    try { navigator.clipboard.writeText(cp.dataset.copy).then(done, () => window.getSelection().selectAllChildren(cp.querySelector("code"))); }
    catch (err) { window.getSelection().selectAllChildren(cp.querySelector("code")); }
    return;
  }
  if (e.target.closest("[data-hidden-toggle]")) { state.showHidden = !state.showHidden; render(); return; }
  const g = e.target.closest("[data-go]");
  if (g && !e.target.closest("a[href]")) { e.preventDefault(); go(g.dataset.go); return; }
  if (e.target.closest("[data-old]")) { state.showOld = !state.showOld; render(); return; }
  if (e.target.closest("[data-menu]")) byId("side").classList.toggle("open");
});
document.addEventListener("keydown", e => {
  if (e.key === "Enter" && e.target.matches("tr[data-go]")) go(e.target.dataset.go);
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); byId("q").focus(); }
  if (e.key === "Escape") { byId("side").classList.remove("open"); if (state.capture) { state.capture = null; renderOverlay(); } }
  if (e.key === "Enter" && !e.shiftKey && e.target.id === "ideaText") { e.preventDefault(); saveCapture(); }
  if (e.key.toLowerCase() === "i" && !e.metaKey && !e.ctrlKey && !state.capture && !/INPUT|TEXTAREA/.test(document.activeElement?.tagName || "")) { e.preventDefault(); openCapture(null); }
});
for (const id of ["q", "q2"]) byId(id).addEventListener("input", e => {
  state.query = e.target.value.trim().toLowerCase();
  byId(id === "q" ? "q2" : "q").value = e.target.value;
  if (state.view !== "services" && state.view !== "") state.view = "";
  render();
});
const start = location.hash.slice(1);
state.view = P.some(p => p.id === start) || start === "services" ? start : "";
render();
