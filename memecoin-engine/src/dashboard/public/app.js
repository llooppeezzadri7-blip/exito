/* Shared dashboard helpers (no framework, no build step). */
const API = (path) => fetch(path + (path.includes("?") ? "&" : "?") + "t=" + Date.now(), { headers: authHeaders() }).then(async (r) => { if (!r.ok) throw new Error(await r.text()); return r.json(); });
function authHeaders() { const t = localStorage.getItem("apiToken"); return t ? { authorization: "Bearer " + t } : {}; }
const usd = (v) => v == null ? "—" : v >= 1e6 ? "$" + (v / 1e6).toFixed(2) + "M" : v >= 1e3 ? "$" + (v / 1e3).toFixed(1) + "K" : "$" + Number(v).toFixed(v < 1 ? 4 : 0);
const num = (v, d = 0) => v == null ? "—" : Number(v).toFixed(d);
const age = (iso) => { if (!iso) return "—"; const m = (Date.now() - new Date(iso).getTime()) / 60000; return m < 60 ? Math.round(m) + "m" : m < 1440 ? Math.floor(m / 60) + "h " + Math.round(m % 60) + "m" : Math.floor(m / 1440) + "d"; };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function riskBadge(r) { const m = { RELATIVELY_LOW_RISK: "b-green", LOW_RISK: "b-green", MEDIUM_RISK: "b-amber", HIGH_RISK: "b-red", EXTREME_RISK: "b-red", UNKNOWN: "b-gray" }; return `<span class="badge ${m[r] || "b-gray"}">${esc((r || "UNKNOWN").replace(/_/g, " "))}</span>`; }
function catBadge(c) { const m = { HIGH_CONVICTION_SETUP: "b-green", WATCHLIST: "b-blue", EXTREME_RISK: "b-red", REJECTED: "b-gray", NO_OPPORTUNITY: "b-gray", INSUFFICIENT_DATA: "b-amber", SECURITY_UNVERIFIED: "b-amber", INVESTIGATE: "b-purple" }; return `<span class="badge ${m[c] || "b-gray"}">${esc((c || "—").replace(/_/g, " "))}</span>`; }
function phaseBadge(p) { const m = { EARLY: "b-green", LATE: "b-amber", EXHAUSTED: "b-red", UNKNOWN: "b-gray" }; return `<span class="badge ${m[p] || "b-gray"}">${esc(p || "?")}</span>`; }
function bar(v) { return v == null ? '<span class="muted">—</span>' : `<div style="display:flex;align-items:center;gap:6px"><div class="bar"><i style="width:${Math.max(0, Math.min(100, v))}%"></i></div><span class="small">${Math.round(v)}</span></div>`; }
function setLive(health) { const el = document.getElementById("live"); if (!el || !health) return; const lat = health.dataLatencySec; const dot = el.querySelector(".dot"); dot.className = "dot " + (lat == null ? "down" : lat > 600 ? "stale" : ""); el.querySelector("span.t").textContent = lat == null ? "no worker data" : "data latency " + lat + "s"; }
async function post(path) { const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json", ...authHeaders() } }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || r.statusText); return j; }
window.D = { API, usd, num, age, esc, riskBadge, catBadge, phaseBadge, bar, setLive, post };
