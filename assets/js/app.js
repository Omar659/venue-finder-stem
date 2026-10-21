/* Venue Finder STEM — main application (vanilla JS, no build step). */
(function () {
  "use strict";

  const VT = window.VT;
  const DATA_FILES = { conf: "data/conferences.json", jour: "data/journals.json", tags: "data/tags.json", meta: "data/meta.json" };
  const CORE_ORDER = { "A*": 0, A: 1, B: 2, C: 3 };
  const Q_ORDER = { Q1: 0, Q2: 1, Q3: 2, Q4: 3 };
  const MAX_COMPARE = 4;

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  function esc(s) {
    if (s == null) return "";
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  const NA = '<span class="na">non disponibile</span>';
  const ICON_PIN = '<svg class="ico" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>';
  const ICON_CAL = '<svg class="ico" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>';
  const nf1 = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 1 });
  const nf3 = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 3 });
  const nfInt = new Intl.NumberFormat("it-IT");

  const store = {
    get(k, def) { try { const v = localStorage.getItem(k); return v == null ? def : JSON.parse(v); } catch (e) { return def; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } },
  };

  // ---------------------------------------------------------------- state
  const DEFAULT_STATE = { type: "all", q: "", tags: [], country: "", ranks: [], deadline: "", quartiles: [], oa: "", si: false, sort: "deadline" };
  let state = Object.assign({}, DEFAULT_STATE, store.get("vf-state", {}));
  let compare = new Set(store.get("vf-compare", []));
  let venues = [];
  let byId = new Map();
  let tags = [];
  let tagById = new Map();
  let meta = {};
  let lastFocus = null;

  function saveState() { store.set("vf-state", state); }

  // ---------------------------------------------------------------- helpers on data
  function domain(url) { try { return new URL(url).hostname.replace(/^www\./, ""); } catch (e) { return url; } }

  function srcHtml(source, prefix, compact) {
    if (!source || !source.url) return "";
    const note = source.note && !compact ? ` — ${esc(source.note)}` : "";
    const title = source.note && compact ? ` title="${esc(source.note)}"` : "";
    const info = source.note && compact ? ' <span aria-hidden="true">ⓘ</span>' : "";
    return `<span class="src"${title}>${prefix == null ? "fonte" : prefix}${prefix === "" ? "" : ": "}<a href="${esc(source.url)}" target="_blank" rel="noopener">${esc(domain(source.url))}</a>, verificato il ${esc(VT.formatDateStr(source.verified))}${note}${info}</span>`;
  }

  function descendants(tagId) {
    const out = new Set([tagId]);
    const stack = [tagId];
    while (stack.length) {
      const t = stack.pop();
      for (const c of (tagById.get(t) || {}).children || []) { if (!out.has(c)) { out.add(c); stack.push(c); } }
    }
    return out;
  }

  function tagLabel(id) { return (tagById.get(id) || {}).label || id; }

  function latestAcceptance(v) {
    const list = (v.type === "conference" ? v.conference.acceptance : v.journal.acceptance) || [];
    const withRate = list.filter((a) => a.rate != null).sort((a, b) => b.year - a.year);
    return withRate[0] || null;
  }

  function coreRank(v) { return v.conference && v.conference.rank && v.conference.rank.core ? v.conference.rank.core.value : null; }

  function latestSjr(v) {
    const list = ((v.journal || {}).metrics || {}).sjr || [];
    return list.slice().sort((a, b) => b.year - a.year)[0] || null;
  }
  function latestOf(list) { return (list || []).slice().sort((a, b) => (b.year || 0) - (a.year || 0))[0] || null; }

  function rankClass(r) {
    if (!r) return "";
    return { "A*": "r-astar", A: "r-a", B: "r-b", C: "r-c", Q1: "q-q1", Q2: "q-q2", Q3: "q-q3", Q4: "q-q4" }[r] || "";
  }

  // Resolves deadlines for a venue at `now` (cached per render pass).
  let resolveCache = new Map();
  function resolved(v, now) {
    if (resolveCache.has(v.id)) return resolveCache.get(v.id);
    let r;
    if (v.type === "conference") r = VT.resolveConference(v, now);
    else {
      const sis = VT.resolveSpecialIssues(v, now);
      const open = sis.filter((s) => s.utc && !s.past);
      r = { specialIssues: sis, openSI: open, next: open[0] || null };
    }
    resolveCache.set(v.id, r);
    return r;
  }

  function nextDeadlineUtc(v, now) {
    const r = resolved(v, now);
    return r.next ? r.next.utc : Infinity;
  }

  // ---------------------------------------------------------------- loading
  async function load() {
    const get = (u) => fetch(u, { cache: "no-cache" }).then((r) => { if (!r.ok) throw new Error(u + ": HTTP " + r.status); return r.json(); });
    const [c, j, t, m] = await Promise.all([get(DATA_FILES.conf), get(DATA_FILES.jour), get(DATA_FILES.tags), get(DATA_FILES.meta)]);
    meta = m;
    tags = t.tags;
    tags.forEach((tg) => tagById.set(tg.id, Object.assign({ children: [] }, tg)));
    tags.forEach((tg) => { if (tg.parent && tagById.has(tg.parent)) tagById.get(tg.parent).children.push(tg.id); });
    venues = [].concat(c.venues, j.venues);
    venues.forEach((v) => {
      byId.set(v.id, v);
      const parts = [v.name, v.acronym, v.id, ...(v.tags || []).map(tagLabel), ...(v.tags || []),
        v.topics && v.topics.intro, ...((v.topics && v.topics.items) || []), v.topics && v.topics.text];
      if (v.type === "conference") {
        const e = v.conference.edition || {};
        parts.push(e.city, e.country, e.label, coreRank(v));
      } else {
        const j2 = v.journal;
        parts.push(j2.publisher, j2.society, j2.issn && j2.issn.print, j2.issn && j2.issn.online);
        (j2.specialIssues || []).forEach((s) => parts.push(s.title));
      }
      v._search = parts.filter(Boolean).join(" \u0001 ").toLowerCase();
    });
    compare = new Set([...compare].filter((id) => byId.has(id)));
  }

  // ---------------------------------------------------------------- filters UI
  function buildFilters() {
    // Tag tree
    const counts = new Map();
    tags.forEach((tg) => {
      const d = descendants(tg.id);
      counts.set(tg.id, venues.filter((v) => v.tags.some((x) => d.has(x))).length);
    });
    const collapsed = store.get("vf-tree", {});
    function node(id) {
      const tg = tagById.get(id);
      const kids = tg.children.filter((k) => counts.get(k) > 0);
      const isCollapsed = collapsed[id] !== false; // collapsed by default
      return `<li data-tag="${esc(id)}" data-collapsed="${kids.length ? isCollapsed : "true"}">
        <div class="tag-row">
          <button type="button" class="twisty ${kids.length ? "" : "leaf"}" aria-label="Espandi ${esc(tg.label)}" aria-expanded="${kids.length ? !isCollapsed : "false"}" ${kids.length ? "" : 'tabindex="-1" aria-hidden="true"'}>▶</button>
          <label class="check" style="flex:1"><input type="checkbox" value="${esc(id)}" ${state.tags.includes(id) ? "checked" : ""}> ${esc(tg.label)} <span class="count">${counts.get(id)}</span></label>
        </div>
        ${kids.length ? `<ul>${kids.map(node).join("")}</ul>` : ""}
      </li>`;
    }
    $("#tag-tree").innerHTML = tags.filter((tg) => !tg.parent && counts.get(tg.id) > 0).map((tg) => node(tg.id)).join("");
    $("#tag-tree").addEventListener("click", (e) => {
      const tw = e.target.closest(".twisty");
      if (!tw || tw.classList.contains("leaf")) return;
      const li = tw.closest("li");
      const now = li.dataset.collapsed !== "true";
      li.dataset.collapsed = String(now);
      tw.setAttribute("aria-expanded", String(!now));
      collapsed[li.dataset.tag] = now;
      store.set("vf-tree", collapsed);
    });
    $("#tag-tree").addEventListener("change", (e) => {
      if (e.target.type !== "checkbox") return;
      const set = new Set(state.tags);
      e.target.checked ? set.add(e.target.value) : set.delete(e.target.value);
      state.tags = [...set];
      update();
    });

    // Countries
    const countries = [...new Set(venues.filter((v) => v.type === "conference").map((v) => v.conference.edition && v.conference.edition.country).filter(Boolean))].sort((a, b) => a.localeCompare(b, "it"));
    $("#f-country").insertAdjacentHTML("beforeend", countries.map((c) => `<option>${esc(c)}</option>`).join(""));

    const rankOpts = [["A*", "A*"], ["A", "A"], ["B", "B"], ["C", "C"], ["other", "Altro / non classificata"]];
    $("#f-rank").innerHTML = rankOpts.map(([v, l]) => `<label class="check"><input type="checkbox" value="${v}"> ${l}</label>`).join("");
    const qOpts = [["Q1", "Q1"], ["Q2", "Q2"], ["Q3", "Q3"], ["Q4", "Q4"], ["na", "Non disponibile"]];
    $("#f-quartile").innerHTML = qOpts.map(([v, l]) => `<label class="check"><input type="checkbox" value="${v}"> ${l}</label>`).join("");

    syncControls();

    $("#type-seg").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-type]");
      if (!b) return;
      state.type = b.dataset.type;
      update();
    });
    let qTimer;
    $("#q").addEventListener("input", (e) => { clearTimeout(qTimer); qTimer = setTimeout(() => { state.q = e.target.value; update(); }, 120); });
    $("#sort").addEventListener("change", (e) => { state.sort = e.target.value; update(); });
    $("#f-country").addEventListener("change", (e) => { state.country = e.target.value; update(); });
    $("#f-deadline").addEventListener("change", (e) => { state.deadline = e.target.value; update(); });
    $("#f-oa").addEventListener("change", (e) => { state.oa = e.target.value; update(); });
    $("#f-si").addEventListener("change", (e) => { state.si = e.target.checked; update(); });
    $("#f-rank").addEventListener("change", () => { state.ranks = $$("#f-rank input:checked").map((i) => i.value); update(); });
    $("#f-quartile").addEventListener("change", () => { state.quartiles = $$("#f-quartile input:checked").map((i) => i.value); update(); });
    $("#reset-btn").addEventListener("click", () => { state = Object.assign({}, DEFAULT_STATE, { sort: state.sort }); syncControls(); update(); });
    $("#filters-toggle").addEventListener("click", () => {
      const open = $("#filters").classList.toggle("open");
      $("#filters-toggle").setAttribute("aria-expanded", String(open));
    });
  }

  function syncControls() {
    $$("#type-seg button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.type === state.type)));
    $("#q").value = state.q;
    $("#sort").value = state.sort;
    $("#f-country").value = state.country;
    $("#f-deadline").value = state.deadline;
    $("#f-oa").value = state.oa;
    $("#f-si").checked = state.si;
    $$("#f-rank input").forEach((i) => { i.checked = state.ranks.includes(i.value); });
    $$("#f-quartile input").forEach((i) => { i.checked = state.quartiles.includes(i.value); });
    $$("#tag-tree input").forEach((i) => { i.checked = state.tags.includes(i.value); });
    $("#conf-filters").hidden = state.type === "journal";
    $("#journal-filters").hidden = state.type === "conference";
  }

  // ---------------------------------------------------------------- filtering & sorting
  function applyFilters(now) {
    const tokens = state.q.toLowerCase().split(/\s+/).filter(Boolean);
    const tagSet = new Set();
    state.tags.forEach((t) => descendants(t).forEach((d) => tagSet.add(d)));
    const confActive = !!(state.country || state.ranks.length || state.deadline);
    const jourActive = !!(state.quartiles.length || state.oa || state.si);

    return venues.filter((v) => {
      if (state.type !== "all" && v.type !== state.type) return false;
      if (tokens.length && !tokens.every((t) => v._search.includes(t))) return false;
      if (tagSet.size && !v.tags.some((t) => tagSet.has(t))) return false;
      if (v.type === "conference") {
        if (jourActive && !confActive) return false;
        const e = v.conference.edition || {};
        if (state.country && e.country !== state.country) return false;
        if (state.ranks.length) {
          const r = coreRank(v);
          const key = r in CORE_ORDER ? r : "other";
          if (!state.ranks.includes(key)) return false;
        }
        if (state.deadline) {
          const st = resolved(v, now).status;
          const isOpen = st === "open" || st === "rolling";
          if (state.deadline === "open" && !isOpen) return false;
          if (state.deadline === "closed" && isOpen) return false;
        }
      } else {
        if (confActive && !jourActive) return false;
        if (state.quartiles.length) {
          const s = latestSjr(v);
          const key = s && s.quartile ? s.quartile : "na";
          if (!state.quartiles.includes(key)) return false;
        }
        if (state.oa === "yes" && v.journal.access !== "open") return false;
        if (state.oa === "no" && v.journal.access === "open") return false;
        if (state.si && !resolved(v, now).openSI.length) return false;
      }
      return true;
    });
  }

  function rankKey(v) {
    if (v.type === "conference") { const r = coreRank(v); return [r in CORE_ORDER ? CORE_ORDER[r] : 9, 0]; }
    const s = latestSjr(v);
    return [s && s.quartile in Q_ORDER ? Q_ORDER[s.quartile] : 9, s && s.value != null ? -s.value : 0];
  }

  function byName(a, b) { return (a.acronym || a.name).localeCompare(b.acronym || b.name, "it", { sensitivity: "base" }); }

  function sortList(list, now) {
    const s = state.sort;
    if (s === "name") return list.sort(byName);
    if (s === "rank") return list.sort((a, b) => { const ka = rankKey(a), kb = rankKey(b); return ka[0] - kb[0] || ka[1] - kb[1] || byName(a, b); });
    if (s === "acceptance") return list.sort((a, b) => {
      const ra = latestAcceptance(a), rb = latestAcceptance(b);
      return (ra ? ra.rate : Infinity) - (rb ? rb.rate : Infinity) || byName(a, b);
    });
    return list.sort((a, b) => nextDeadlineUtc(a, now) - nextDeadlineUtc(b, now) || byName(a, b));
  }

  // Groups to avoid misleading mixed rankings (CORE vs SJR scales).
  function groupList(list, now) {
    if (state.sort === "rank" && state.type === "all") {
      return [
        { title: "Conferenze", hint: "ordinate per rank CORE (ICORE2026): A* → A → B → C → altro", items: list.filter((v) => v.type === "conference") },
        { title: "Journal", hint: "ordinati per quartile SJR migliore, poi valore SJR", items: list.filter((v) => v.type === "journal") },
      ].filter((g) => g.items.length);
    }
    if (state.sort === "deadline") {
      const withDl = list.filter((v) => nextDeadlineUtc(v, now) !== Infinity);
      const without = list.filter((v) => nextDeadlineUtc(v, now) === Infinity);
      const groups = [];
      if (withDl.length) groups.push({ title: "Prossime scadenze", hint: "deadline ufficiali e stimate, la più vicina per prima", items: withDl });
      if (without.length) groups.push({ title: "Senza scadenze imminenti", hint: "journal con submission sempre aperta, conferenze a sottomissione continua o con date non disponibili", items: without });
      return groups;
    }
    if (state.sort === "acceptance") {
      const a = list.filter((v) => latestAcceptance(v)), b = list.filter((v) => !latestAcceptance(v));
      return [
        { title: "Con acceptance rate verificato", hint: "più selettive prima (ultimo anno disponibile)", items: a },
        { title: "Acceptance rate non disponibile", hint: "", items: b },
      ].filter((g) => g.items.length);
    }
    return [{ title: null, items: list }];
  }

  // ---------------------------------------------------------------- list rendering
  function deadlineCell(v, now) {
    const r = resolved(v, now);
    if (v.type === "journal") {
      if (r.next) {
        return `<div><span class="badge badge-official">special issue</span></div>
          <div class="big">${esc(VT.formatDateStr(r.next.deadline.date))}</div>
          <div class="countdown" data-utc="${r.next.utc}">${esc(VT.formatCountdown(r.next.utc - now))}</div>
          <div class="faint">+ submission sempre aperta</div>`;
      }
      return `<div class="big">Submission sempre aperta</div><div class="faint">nessuna special issue aperta nei dati</div>`;
    }
    if (r.status === "rolling") return `<div class="big">Submission continua</div><div class="faint">modello rolling (journal-first)</div>`;
    if (!r.next) {
      if (r.status === "closed-unknown") return `<div><span class="badge badge-closed">chiusa</span></div><div class="na">prossima non disponibile</div>`;
      return `<div class="na">non disponibile</div>`;
    }
    const n = r.next;
    const lbl = n.label || VT.PHASE_LABELS[n.phase] || n.phase;
    return `<div>${n.estimated ? '<span class="badge badge-est">stimata</span>' : '<span class="badge badge-official">ufficiale</span>'} <span class="faint">${esc(lbl)}</span></div>
      <div class="big ${n.estimated ? "est" : ""}">${n.estimated ? "~ " : ""}${esc(VT.formatDateStr(n.date))}</div>
      <div class="countdown ${n.estimated ? "est" : ""}" data-utc="${n.utc}">${esc(VT.formatCountdown(n.utc - now))}</div>`;
  }

  function rankCell(v) {
    if (v.type === "conference") {
      const c = v.conference.rank.core;
      if (!c || !c.value) return `<span class="badge badge-na">non in CORE</span>`;
      const ranked = c.value in CORE_ORDER;
      return `<span class="badge badge-rank ${rankClass(c.value)}" title="CORE ${esc(c.edition)}">${esc(ranked ? c.value : c.value)}</span><div class="faint">CORE ${esc(c.edition)}</div>`;
    }
    const s = latestSjr(v);
    const jif = latestOf(v.journal.metrics.jif);
    if (!s) return `<span class="badge badge-na">n.d.</span>`;
    return `<span class="badge badge-rank ${rankClass(s.quartile)}">${esc(s.quartile || "n.d.")}</span>
      <div class="faint">SJR ${s.value != null ? nf3.format(s.value) : "n.d."} (${s.year})</div>
      ${jif ? `<div class="faint">IF ${nf1.format(jif.value)} (${jif.year})</div>` : ""}`;
  }

  function accCell(v) {
    const a = latestAcceptance(v);
    if (!a) return `<span class="na">n.d.</span>`;
    return `<div class="big">${nf1.format(a.rate)}%</div><div class="faint">${a.year}</div>`;
  }

  function subLine(v) {
    if (v.type === "conference") {
      const e = v.conference.edition || {};
      const place = e.city || e.country ? [e.city, e.country].filter(Boolean).join(", ") : null;
      const dates = e.start ? (e.end && e.end !== e.start ? `${VT.formatDateStr(e.start)} – ${VT.formatDateStr(e.end)}` : VT.formatDateStr(e.start)) : null;
      return `<span>${esc(e.label || "")}</span>
        <span>${ICON_PIN} ${place ? esc(place) : '<span class="na">luogo n.d.</span>'}</span>
        <span>${ICON_CAL} ${dates ? esc(dates) : '<span class="na">date n.d.</span>'}</span>`;
    }
    const j = v.journal;
    const issn = [j.issn.print && `p ${j.issn.print}`, j.issn.online && `e ${j.issn.online}`].filter(Boolean).join(" · ");
    const acc = { open: '<span class="badge badge-oa">Open access</span>', hybrid: "Ibrido", subscription: "Abbonamento" }[j.access] || "";
    return `<span>${esc(j.publisher)}</span><span class="mono">ISSN ${esc(issn)}</span><span>${acc}</span>`;
  }

  function rowHtml(v, now) {
    const typeBadge = v.type === "conference" ? '<span class="badge badge-conf">Conferenza</span>' : '<span class="badge badge-journal">Journal</span>';
    const tagChips = v.tags.slice(0, 4).map((t) => `<span class="chip">${esc(tagLabel(t))}</span>`).join("");
    return `<article class="row ${v.type}" data-id="${esc(v.id)}">
      <div class="row-main">
        <div class="row-title">${typeBadge}
          <button class="open-btn" type="button" data-open="${esc(v.id)}"><span class="acr">${esc(v.acronym || v.name)}</span></button>
          <span class="name">${esc(v.acronym ? v.name : "")}</span>
        </div>
        <div class="row-sub">${subLine(v)}</div>
        <div class="chips">${tagChips}</div>
      </div>
      <div class="cell cell-rank"><span class="cell-label">${v.type === "conference" ? "Rank" : "Quartile / metriche"}</span>${rankCell(v)}</div>
      <div class="cell cell-dl"><span class="cell-label">Prossima deadline</span>${deadlineCell(v, now)}</div>
      <div class="cell cell-acc"><span class="cell-label">Acceptance</span>${accCell(v)}</div>
      <div class="compare-cell"><input type="checkbox" aria-label="Aggiungi ${esc(v.acronym || v.name)} al confronto" data-compare="${esc(v.id)}" ${compare.has(v.id) ? "checked" : ""}></div>
    </article>`;
  }

  function renderList() {
    const now = Date.now();
    resolveCache = new Map();
    const list = sortList(applyFilters(now), now);
    const groups = groupList(list, now);
    const nConf = list.filter((v) => v.type === "conference").length;
    $("#count").textContent = `${list.length} risultati · ${nConf} conferenze · ${list.length - nConf} journal`;
    if (!list.length) {
      $("#results").innerHTML = `<div class="empty">Nessuna venue corrisponde ai filtri. <button class="btn" type="button" id="empty-reset">Azzera filtri</button></div>`;
      $("#empty-reset").addEventListener("click", () => $("#reset-btn").click());
      return;
    }
    const heads = `<div class="col-heads" aria-hidden="true"><span>Venue</span><span>Rank / quartile</span><span>Prossima deadline</span><span class="h-acc">Acceptance</span><span></span></div>`;
    $("#results").innerHTML = heads + groups.map((g) =>
      (g.title ? `<h2 class="group-title">${esc(g.title)} <span class="hint">${esc(g.hint || "")} · ${g.items.length}</span></h2>` : "") +
      g.items.map((v) => rowHtml(v, now)).join("")).join("");
  }

  function update() {
    saveState();
    syncControls();
    renderList();
  }

  // ---------------------------------------------------------------- detail drawer
  function timelineHtml(list, now, nextUtc, opts) {
    opts = opts || {};
    return `<ul class="timeline">${list.map((d) => {
      const lbl = d.label || VT.PHASE_LABELS[d.phase] || d.phase;
      const isNext = nextUtc && d.utc === nextUtc && VT.SUBMISSION_PHASES.includes(d.phase);
      const tzNote = d.tzStated === false ? ' <span class="faint" title="La fonte non indica il fuso orario">(fuso non indicato: assunto AoE)</span>' : "";
      const right = d.past ? '<span class="badge badge-closed">chiusa</span>'
        : `<span class="countdown ${d.estimated ? "est" : ""}" data-utc="${d.utc}" data-sec="1">${esc(VT.formatCountdown(d.utc - now, true))}</span>`;
      return `<li class="${d.past ? "past" : ""} ${d.estimated ? "estimated" : ""} ${isNext ? "next" : ""}">
        <span class="dot" aria-hidden="true"></span>
        <div><div class="tl-label">${esc(lbl)} ${d.estimated ? '<span class="badge badge-est">stimata</span>' : (opts.noBadge ? "" : '<span class="badge badge-official">ufficiale</span>')}${d.cycle ? ` <span class="chip">${esc(d.cycle)}</span>` : ""}</div>
          <div class="tl-when">${d.estimated ? "~ " : ""}${esc(VT.formatOriginal(d))}${tzNote}</div>
          <div class="tl-when faint">Ora locale: ${esc(VT.formatLocal(d.utc))}</div>
          ${d.source ? `<div>${srcHtml(d.source)}</div>` : ""}</div>
        <div class="tl-right">${right}</div>
      </li>`;
    }).join("")}</ul>`;
  }

  function acceptanceSection(list, title) {
    if (!list || !list.length) {
      return `<section class="section"><h3>${title}</h3><p class="na">Non disponibile: nessun dato verificabile su fonte ufficiale.</p></section>`;
    }
    const sorted = list.slice().sort((a, b) => a.year - b.year);
    const chart = window.VCharts.history(sorted.map((a) => ({ x: a.year, y: a.rate, submitted: a.submitted, accepted: a.accepted })), { unit: "%", label: "Andamento acceptance rate", decimals: 1 });
    return `<section class="section"><h3>${title}</h3>
      ${chart || '<p class="faint">Un solo anno disponibile: grafico non mostrato.</p>'}
      ${chart && sorted.some((a) => a.submitted) ? '<p class="faint" style="font-size:12px;margin:0">Barre: sottomessi (chiaro) e accettati (scuro), scala a destra · Linea: acceptance rate, scala a sinistra.</p>' : ""}
      <div class="table-wrap"><table class="data"><thead><tr><th>Anno</th><th>Rate</th><th>Sottomessi</th><th>Accettati</th><th>Fonte</th></tr></thead><tbody>
      ${sorted.slice().reverse().map((a) => `<tr><td>${a.year}${a.track ? ` <span class="chip">${esc(a.track)}</span>` : ""}</td>
        <td class="num">${a.rate != null ? nf1.format(a.rate) + "%" : "n.d."}</td>
        <td class="num">${a.submitted ? nfInt.format(a.submitted) : '<span class="na">n.d.</span>'}</td>
        <td class="num">${a.accepted ? nfInt.format(a.accepted) : '<span class="na">n.d.</span>'}</td>
        <td>${srcHtml(a.source, "")}${a.note ? `<div class="faint" style="font-size:12px">${esc(a.note)}</div>` : ""}</td></tr>`).join("")}
      </tbody></table></div></section>`;
  }

  function topicsSection(v, title) {
    const t = v.topics || {};
    let body = "";
    if (t.intro) body += `<p>${esc(t.intro)}</p>`;
    if (t.items && t.items.length) body += `<ul class="topic-list">${t.items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`;
    if (t.text) body += `<div class="scope-text">${t.text.split("\n").map((p) => `<p>${esc(p)}</p>`).join("")}</div>`;
    if (!body) body = `<p class="na">Non disponibile.</p>`;
    return `<section class="section highlight"><h3>${title}</h3>${body}<div>${srcHtml(t.source)}</div></section>`;
  }

  function factHtml(label, value, source) {
    return `<div class="fact"><dt>${esc(label)}</dt><dd>${value == null || value === "" ? NA : value}${source ? `<div>${srcHtml(source, "fonte", true)}</div>` : ""}</dd></div>`;
  }

  function conferenceDetail(v, now) {
    const c = v.conference;
    const e = c.edition || {};
    const r = resolved(v, now);
    const place = [e.city, e.country].filter(Boolean).join(", ");
    const dates = e.start ? (e.end && e.end !== e.start ? `${VT.formatDateStr(e.start)} – ${VT.formatDateStr(e.end)}` : VT.formatDateStr(e.start)) : null;
    const core = c.rank.core || {};
    const rankVal = core.value ? `<span class="badge badge-rank ${rankClass(core.value)}">${esc(core.value)}</span> <span class="faint">${esc(core.edition)}</span>${core.previous ? ` <span class="faint">(${esc(core.previous.edition)}: ${esc(core.previous.value)})</span>` : ""}` : null;
    const coreSrc = core.url ? { url: core.url, verified: core.verified, note: core.note } : null;
    const lastAcc = latestAcceptance(v);

    let dlBlock = "";
    if (r.status === "rolling") {
      dlBlock = `<p><strong>Submission continua.</strong> Nessuna deadline per edizione.</p>`;
    } else {
      if (r.official.length) dlBlock += `<p class="faint" style="margin:0 0 6px">Deadline ufficiali di ${esc(e.label || "questa edizione")}</p>` + timelineHtml(r.official, now, r.next && !r.next.estimated ? r.next.utc : null);
      else dlBlock += `<p class="na">Deadline ufficiali dell'edizione ${esc(e.label || "")} non ancora pubblicate.</p>`;
      if (r.estimated.length) {
        const yrs = c.recurrence === 2 ? "due anni" : "un anno";
        dlBlock += `<div class="note warn" style="margin:14px 0 8px"><strong>Deadline stimate</strong> per la prossima edizione: ottenute spostando di ${yrs} (o multipli) le date ufficiali di <em>${esc(r.basis || "ciclo precedente")}</em>. Non sono date ufficiali: verifica sul sito appena esce la call.</div>`
          + timelineHtml(r.estimated, now, r.next && r.next.estimated ? r.next.utc : null);
      } else if (r.status === "closed-unknown" || (!r.official.length && r.status === "unknown")) {
        dlBlock += `<p class="na" style="margin-top:8px">Stima non disponibile (mancano le date del ciclo precedente).</p>`;
      }
    }

    const ws = c.workshops || {};
    const wsDeadlines = (ws.deadlines || []).map((d) => Object.assign({}, d, { utc: VT.deadlineUtc(d), past: VT.deadlineUtc(d) < now }));
    const wsItems = ws.items || [];
    const wsList = wsItems.length ? `<details ${wsItems.length <= 8 ? "open" : ""}><summary>${wsItems.length} workshop</summary><ul class="ws-list">${wsItems.map((w) =>
        `<li><strong>${w.url ? `<a href="${esc(w.url)}" target="_blank" rel="noopener">${esc(w.name)}</a>` : esc(w.name)}</strong>${w.when ? ` <span class="faint">· ${esc(w.when)}</span>` : ""}${w.topics ? `<div class="muted" style="font-size:13px">${esc(w.topics)}</div>` : ""}${w.deadline ? `<div class="faint">Deadline: ${esc(VT.formatOriginal(w.deadline))}</div>` : ""}</li>`).join("")}</ul></details>` : "";
    const wsBody = (ws.note ? `<p>${esc(ws.note)}</p>` : "")
      + (wsDeadlines.length ? timelineHtml(wsDeadlines, now, null) : "")
      + wsList
      + (ws.url ? `<p><a href="${esc(ws.url)}" target="_blank" rel="noopener">Pagina workshop / call ufficiale ↗</a></p>` : "")
      + (ws.source ? `<div>${srcHtml(ws.source)}</div>` : "");
    const p = c.proceedings || {};

    return `
      <section class="section"><dl class="facts">
        ${factHtml("Edizione", esc(e.label), e.source)}
        ${factHtml("Luogo", place ? esc(place) + (e.format && e.format !== "in-person" ? ` (${esc(e.format)})` : "") : null)}
        ${factHtml("Date evento", dates ? esc(dates) : null)}
        ${factHtml("Rank CORE", rankVal, coreSrc)}
        ${factHtml("Acceptance rate (ultimo)", lastAcc ? `${nf1.format(lastAcc.rate)}% <span class="faint">(${lastAcc.year})</span>` : null)}
        ${factHtml("Cadenza", c.recurrence === 2 ? "Biennale" : "Annuale")}
      </dl>
      ${e.note ? `<p class="note" style="margin-top:10px">${esc(e.note)}</p>` : ""}</section>
      ${topicsSection(v, "Topic della main track")}
      <section class="section"><h3>Deadline</h3>${dlBlock}</section>
      <section class="section"><h3>Workshop</h3>${wsBody || '<p class="na">Informazioni sui workshop non disponibili.</p>'}</section>
      <section class="section"><h3>Proceedings</h3>
        <dl class="facts">
          ${factHtml("Editore", esc(p.publisher))}
          ${factHtml("Serie", esc(p.series))}
          ${factHtml("Indicizzazione / piattaforme", p.indexing && p.indexing.length ? esc(p.indexing.join(", ")) : null)}
          ${factHtml("Accesso", p.openAccess === true ? "Open access" : p.openAccess === false ? "Non open access (accesso tramite editore)" : null)}
        </dl>
        ${p.url ? `<p><a href="${esc(p.url)}" target="_blank" rel="noopener">Proceedings ↗</a></p>` : ""}
      </section>
      ${acceptanceSection(c.acceptance, "Storico acceptance rate")}`;
  }

  function journalDetail(v, now) {
    const j = v.journal;
    const r = resolved(v, now);
    const s = latestSjr(v);
    const jif = latestOf(j.metrics.jif);
    const cs = latestOf(j.metrics.citescore);
    const accLbl = { open: '<span class="badge badge-oa">Fully open access</span>', hybrid: "Ibrido (abbonamento + OA opzionale)", subscription: "Abbonamento" }[j.access];
    const apc = j.apc ? (j.apc.amount != null ? `${j.apc.amount === 0 ? "Nessuna APC" : nfInt.format(j.apc.amount) + " " + esc(j.apc.currency || "")}` : "") + (j.apc.note ? `<div class="faint" style="font-weight:400">${esc(j.apc.note)}</div>` : "") : null;
    const idx = j.indexing || {};
    const yn = (x) => (x === true ? "Sì" : x === false ? "No" : '<span class="na">n.d.</span>');

    // metric history
    const sjrPts = (j.metrics.sjr || []).filter((x) => x.value != null).map((x) => ({ x: x.year, y: x.value }));
    const jifPts = (j.metrics.jif || []).filter((x) => x.year).map((x) => ({ x: x.year, y: x.value }));
    const metricRows = [].concat(
      (j.metrics.sjr || []).map((x) => ({ k: "SJR (SCImago)", year: x.year, val: x.value != null ? nf3.format(x.value) : '<span class="na">n.d.</span>', extra: x.quartile ? `<span class="badge badge-rank ${rankClass(x.quartile)}">${esc(x.quartile)}</span>` : "", src: x.source })),
      (j.metrics.jif || []).map((x) => ({ k: "Impact Factor (JCR)", year: x.year, val: nf1.format(x.value), extra: "", src: x.source })),
      (j.metrics.citescore || []).map((x) => ({ k: "CiteScore (Scopus)", year: x.year, val: nf1.format(x.value), extra: "", src: x.source })),
    ).sort((a, b) => a.k.localeCompare(b.k) || (b.year || 0) - (a.year || 0));
    const charts = (sjrPts.length >= 2 ? `<p class="faint" style="margin:6px 0 0">Andamento SJR</p>${window.VCharts.history(sjrPts, { label: "Andamento SJR", decimals: 3 })}` : "")
      + (jifPts.length >= 2 ? `<p class="faint" style="margin:6px 0 0">Andamento Impact Factor</p>${window.VCharts.history(jifPts, { label: "Andamento Impact Factor", decimals: 1 })}` : "");

    const siHtml = r.specialIssues.length ? `<ul class="timeline">${r.specialIssues.map((si) => `<li class="${si.past ? "past" : ""}">
        <span class="dot" aria-hidden="true"></span>
        <div><div class="tl-label"><a href="${esc(si.url)}" target="_blank" rel="noopener">${esc(si.title)}</a></div>
          ${si.deadline ? `<div class="tl-when">Deadline: ${esc(VT.formatOriginal(si.deadline))}${si.deadline.tzStated === false ? ' <span class="faint">(fuso non indicato: assunto AoE)</span>' : ""}</div><div class="tl-when faint">Ora locale: ${esc(VT.formatLocal(si.utc))}</div>` : ""}
          <div>${srcHtml(si.source)}</div></div>
        <div class="tl-right">${si.past ? '<span class="badge badge-closed">chiusa</span>' : `<span class="countdown" data-utc="${si.utc}" data-sec="1">${esc(VT.formatCountdown(si.utc - now, true))}</span>`}</div>
      </li>`).join("")}</ul><p class="faint" style="font-size:12px">Per le special issue non viene mai stimata alcuna data.</p>` : `<p class="na">Nessuna special issue nei dati (le call cambiano spesso: controlla il sito del journal).</p>`;

    return `
      <section class="section"><dl class="facts">
        ${factHtml("ISSN", `<span class="mono">${[j.issn.print && "print " + esc(j.issn.print), j.issn.online && "online " + esc(j.issn.online)].filter(Boolean).join("<br>")}</span>`)}
        ${factHtml("Editore", esc(j.publisher) + (j.society ? `<div class="faint" style="font-weight:400">${esc(j.society)}</div>` : ""))}
        ${factHtml("Quartile SJR (migliore)", s && s.quartile ? `<span class="badge badge-rank ${rankClass(s.quartile)}">${esc(s.quartile)}</span> <span class="faint">${s.year}</span>` : null)}
        ${factHtml("SJR", s && s.value != null ? `${nf3.format(s.value)} <span class="faint">(${s.year})</span>` : null)}
        ${factHtml("Impact Factor", jif ? `${nf1.format(jif.value)} <span class="faint">(JIF ${jif.year})</span>` : null)}
        ${factHtml("CiteScore", cs ? `${nf1.format(cs.value)} <span class="faint">(${cs.year || "anno n.d."})</span>` : null)}
        ${factHtml("Modello di pubblicazione", accLbl)}
        ${factHtml("APC", apc, j.apc && j.apc.source)}
        ${factHtml("Submission", "Sempre aperta (submission continua)")}
      </dl></section>
      ${topicsSection(v, "Aims & scope")}
      <section class="section"><h3>Special issue</h3>${siHtml}</section>
      <section class="section"><h3>Metriche e storico</h3>
        ${charts || '<p class="faint">Storico non disponibile: per ora è verificato solo l\'ultimo anno pubblicato (SJR 2025 / JIF 2025).</p>'}
        <div class="table-wrap"><table class="data"><thead><tr><th>Metrica</th><th>Anno</th><th>Valore</th><th>Fonte</th></tr></thead><tbody>
          ${metricRows.length ? metricRows.map((m) => `<tr><td>${m.k} ${m.extra}</td><td>${m.year || '<span class="na">n.d.</span>'}</td><td class="num">${m.val}</td><td>${srcHtml(m.src, "")}</td></tr>`).join("") : `<tr><td colspan="4" class="na">Nessuna metrica disponibile</td></tr>`}
        </tbody></table></div>
      </section>
      <section class="section"><h3>Indicizzazione</h3>
        <dl class="facts">${factHtml("Scopus", yn(idx.scopus))}${factHtml("Web of Science", yn(idx.wos))}${factHtml("DOAJ", yn(idx.doaj))}</dl>
        ${idx.note ? `<p class="faint" style="font-size:13px">${esc(idx.note)}</p>` : ""}
      </section>
      <section class="section"><h3>Tempi di revisione</h3>
        ${j.review ? `<p>${esc(j.review.text)}</p>${srcHtml(j.review.source)}` : '<p class="na">Non dichiarati dall\'editore (o dati discordanti).</p>'}
      </section>
      ${acceptanceSection(j.acceptance, "Acceptance rate")}
      ${j.submitUrl ? `<p><a href="${esc(j.submitUrl)}" target="_blank" rel="noopener">Portale di sottomissione ↗</a></p>` : ""}`;
  }

  function collectSources(obj, out) {
    if (!obj || typeof obj !== "object") return out;
    if (Array.isArray(obj)) { obj.forEach((x) => collectSources(x, out)); return out; }
    if (obj.url && obj.verified) out.set(obj.url, obj);
    Object.keys(obj).forEach((k) => { if (k !== "_search") collectSources(obj[k], out); });
    return out;
  }

  function openDetail(id, pushHash) {
    const v = byId.get(id);
    if (!v) return;
    const now = Date.now();
    resolveCache.delete(v.id);
    lastFocus = document.activeElement;
    const typeBadge = v.type === "conference" ? '<span class="badge badge-conf">Conferenza</span>' : '<span class="badge badge-journal">Journal</span>';
    const sources = [...collectSources(v, new Map()).values()];
    const drawer = $("#drawer");
    drawer.innerHTML = `
      <div class="drawer-head ${v.type}">
        <div>
          <div>${typeBadge} ${v.tags.map((t) => `<span class="chip">${esc(tagLabel(t))}</span>`).join(" ")}</div>
          <h2 id="drawer-title">${esc(v.acronym ? v.acronym + " — " : "")}${esc(v.name)}</h2>
          <div style="margin-top:4px"><a href="${esc(v.website)}" target="_blank" rel="noopener">Sito ufficiale ↗</a>
            · <label class="check" style="display:inline-flex"><input type="checkbox" data-compare="${esc(v.id)}" ${compare.has(v.id) ? "checked" : ""}> Confronta</label></div>
        </div>
        <button class="icon-btn close" type="button" id="drawer-close" aria-label="Chiudi dettaglio">✕</button>
      </div>
      <div class="drawer-body">
        ${v.type === "conference" ? conferenceDetail(v, now) : journalDetail(v, now)}
        ${v.notes ? `<section class="section"><h3>Note</h3><p class="note">${esc(v.notes)}</p></section>` : ""}
        <section class="section"><h3>Tutte le fonti (${sources.length})</h3>
          <ol class="sources-list">${sources.map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.url)}</a> <span class="faint">— verificato il ${esc(VT.formatDateStr(s.verified))}</span></li>`).join("")}</ol>
        </section>
      </div>`;
    drawer.hidden = false;
    $("#scrim").hidden = false;
    document.body.style.overflow = "hidden";
    drawer.scrollTop = 0;
    $("#drawer-close").focus();
    $("#drawer-close").addEventListener("click", () => closeDetail(true));
    if (pushHash && location.hash !== "#v=" + id) history.pushState(null, "", "#v=" + encodeURIComponent(id));
  }

  function closeDetail(fromUser) {
    if ($("#drawer").hidden) return;
    $("#drawer").hidden = true;
    $("#scrim").hidden = true;
    document.body.style.overflow = "";
    if (fromUser && location.hash.startsWith("#v=")) history.pushState(null, "", location.pathname + location.search);
    if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
  }

  function routeFromHash() {
    const m = location.hash.match(/^#v=(.+)$/);
    if (m) openDetail(decodeURIComponent(m[1]), false); else closeDetail(false);
  }

  // ---------------------------------------------------------------- compare
  function toggleCompare(id, on) {
    if (on) {
      if (compare.size >= MAX_COMPARE && !compare.has(id)) {
        alert(`Puoi confrontare al massimo ${MAX_COMPARE} venue.`);
        $$(`[data-compare="${CSS.escape(id)}"]`).forEach((i) => { i.checked = false; });
        return;
      }
      compare.add(id);
    } else compare.delete(id);
    store.set("vf-compare", [...compare]);
    $$(`[data-compare="${CSS.escape(id)}"]`).forEach((i) => { i.checked = compare.has(id); });
    renderTray();
  }

  function renderTray() {
    const tray = $("#compare-tray");
    tray.hidden = compare.size === 0;
    $("#compare-names").textContent = `Confronto (${compare.size}/${MAX_COMPARE}): ` + [...compare].map((id) => (byId.get(id) || {}).acronym || id).join(", ");
  }

  function openCompare() {
    const now = Date.now();
    resolveCache = new Map();
    const list = [...compare].map((id) => byId.get(id)).filter(Boolean);
    const row = (label, fn) => `<tr><th>${label}</th>${list.map((v) => `<td>${fn(v)}</td>`).join("")}</tr>`;
    const modal = $("#compare-modal");
    modal.innerHTML = `
      <div class="modal-head"><h2 id="compare-title">Confronto</h2>
        <span class="faint" style="font-size:13px">Rank CORE e quartili SJR sono scale diverse: confrontali solo tra venue dello stesso tipo.</span>
        <button class="icon-btn" type="button" id="compare-close" style="margin-left:auto" aria-label="Chiudi confronto">✕</button></div>
      <div class="modal-body table-wrap"><table class="data compare-table"><thead><tr><th></th>${list.map((v) => `<th><button class="open-btn btn" type="button" data-open-cmp="${esc(v.id)}">${esc(v.acronym || v.name)}</button></th>`).join("")}</tr></thead><tbody>
        ${row("Tipo", (v) => (v.type === "conference" ? '<span class="badge badge-conf">Conferenza</span>' : '<span class="badge badge-journal">Journal</span>'))}
        ${row("Nome", (v) => esc(v.name))}
        ${row("Aree", (v) => v.tags.map((t) => esc(tagLabel(t))).join(", "))}
        ${row("Rank / quartile", (v) => rankCell(v))}
        ${row("Prossima deadline", (v) => deadlineCell(v, now))}
        ${row("Acceptance rate", (v) => accCell(v))}
        ${row("Edizione / editore", (v) => v.type === "conference" ? esc([v.conference.edition.label, [v.conference.edition.city, v.conference.edition.country].filter(Boolean).join(", ")].filter(Boolean).join(" · ")) : esc(v.journal.publisher))}
        ${row("Proceedings / accesso", (v) => v.type === "conference" ? esc([v.conference.proceedings.publisher, v.conference.proceedings.series].filter(Boolean).join(" — ")) : ({ open: "Fully open access", hybrid: "Ibrido", subscription: "Abbonamento" }[v.journal.access] || NA))}
        ${row("Tempi di revisione", (v) => v.type === "journal" && v.journal.review ? esc(v.journal.review.text) : '<span class="na">n.d.</span>')}
        ${row("Sito", (v) => `<a href="${esc(v.website)}" target="_blank" rel="noopener">${esc(domain(v.website))}</a>`)}
      </tbody></table></div>`;
    modal.hidden = false;
    $("#scrim").hidden = false;
    $("#compare-close").focus();
    $("#compare-close").addEventListener("click", closeCompare);
    modal.addEventListener("click", (e) => {
      const b = e.target.closest("[data-open-cmp]");
      if (b) { closeCompare(); openDetail(b.dataset.openCmp, true); }
    });
  }
  function closeCompare() {
    $("#compare-modal").hidden = true;
    if ($("#drawer").hidden) $("#scrim").hidden = true;
  }

  // ---------------------------------------------------------------- theme
  function initTheme() {
    const order = ["auto", "light", "dark"];
    const labels = { auto: "Auto", light: "Chiaro", dark: "Scuro" };
    const icons = { auto: "◐", light: "☀", dark: "☾" };
    let cur = "auto";
    try { cur = localStorage.getItem("vf-theme") || "auto"; } catch (e) { /* storage unavailable */ }
    if (!order.includes(cur)) cur = "auto";
    const apply = () => {
      if (cur === "auto") delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = cur;
      $("#theme-label").textContent = labels[cur];
      $("#theme-icon").textContent = icons[cur];
      $("#theme-btn").setAttribute("aria-label", `Tema: ${labels[cur]} (clic per cambiare)`);
    };
    apply();
    $("#theme-btn").addEventListener("click", () => {
      cur = order[(order.indexOf(cur) + 1) % order.length];
      try { if (cur === "auto") localStorage.removeItem("vf-theme"); else localStorage.setItem("vf-theme", cur); } catch (e) { /* ignore */ }
      apply();
    });
  }

  // ---------------------------------------------------------------- live countdowns
  function tick() {
    const now = Date.now();
    let expired = false;
    $$("[data-utc]").forEach((el) => {
      const ms = Number(el.dataset.utc) - now;
      el.textContent = VT.formatCountdown(ms, el.dataset.sec === "1");
      if (ms <= 0 && !el.dataset.expired) { el.dataset.expired = "1"; expired = true; }
    });
    if (expired) renderList();
  }

  // ---------------------------------------------------------------- events
  function bindGlobal() {
    $("#results").addEventListener("click", (e) => {
      if (e.target.closest("[data-compare]") || e.target.closest("a")) return;
      const row = e.target.closest(".row");
      if (row) openDetail(row.dataset.id, true);
    });
    document.addEventListener("change", (e) => {
      const c = e.target.closest("[data-compare]");
      if (c) toggleCompare(c.dataset.compare, c.checked);
    });
    $("#scrim").addEventListener("click", () => { closeCompare(); closeDetail(true); });
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (!$("#compare-modal").hidden) closeCompare(); else closeDetail(true);
    });
    $("#compare-open").addEventListener("click", openCompare);
    $("#compare-clear").addEventListener("click", () => { [...compare].forEach((id) => toggleCompare(id, false)); });
    window.addEventListener("hashchange", routeFromHash);
    window.addEventListener("popstate", routeFromHash);
  }

  async function main() {
    initTheme();
    try {
      $("#local-tz").textContent = Intl.DateTimeFormat().resolvedOptions().timeZone || "locale";
    } catch (e) { /* ignore */ }
    try {
      await load();
    } catch (err) {
      $("#results").innerHTML = `<div class="empty"><strong>Impossibile caricare i dati.</strong><br>${esc(err.message)}<br><span class="faint">Se hai aperto il file con file://, avvia un server statico (vedi README).</span></div>`;
      return;
    }
    $("#last-verified").textContent = VT.formatDateStr(meta.lastVerified);
    buildFilters();
    bindGlobal();
    renderList();
    renderTray();
    routeFromHash();
    setInterval(tick, 1000);
  }

  main();
})();
