/* Venue Finder STEM — main application (vanilla JS, no build step). */
(function () {
  "use strict";

  const VT = window.VT;
  const I18N = window.I18N;
  const t = (k, p) => I18N.t(k, p);
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
  const NA = () => `<span class="na">${esc(t("na"))}</span>`;
  const ICON_PIN = '<svg class="ico" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>';
  const ICON_CAL = '<svg class="ico" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>';
  let nf1, nf3, nfInt, regionNames;

  const store = {
    get(k, def) { try { const v = localStorage.getItem(k); return v == null ? def : JSON.parse(v); } catch (e) { return def; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } },
  };

  // ---------------------------------------------------------------- state
  const DEFAULT_STATE = { type: "all", q: "", tags: [], country: "", ranks: [], deadline: "", quartiles: [], oa: "", si: false, sort: "deadline" };
  let state = Object.assign({}, DEFAULT_STATE, store.get("vf-state", {}));
  let compare = new Set(store.get("vf-compare", []));
  let venues = [];
  const byId = new Map();
  let tags = [];
  const tagById = new Map();
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
    const lead = prefix === "" ? "" : `${esc(prefix == null ? t("src.label") : prefix)}: `;
    return `<span class="src"${title}>${lead}<a href="${esc(source.url)}" target="_blank" rel="noopener">${esc(domain(source.url))}</a>, ${esc(t("src.verified", { date: VT.formatDateStr(source.verified) }))}${note}${info}</span>`;
  }

  function tagLabel(id) {
    const tg = tagById.get(id);
    if (!tg) return id;
    return typeof tg.label === "string" ? tg.label : (tg.label[I18N.lang] || tg.label.en || id);
  }

  function descendants(tagId) {
    const out = new Set([tagId]);
    const stack = [tagId];
    while (stack.length) {
      const id = stack.pop();
      for (const c of (tagById.get(id) || {}).children || []) { if (!out.has(c)) { out.add(c); stack.push(c); } }
    }
    return out;
  }

  function ancestors(tagId) {
    const out = [];
    let p = (tagById.get(tagId) || {}).parent;
    while (p) { out.push(p); p = (tagById.get(p) || {}).parent; }
    return out;
  }

  function countryName(e) {
    if (!e || !e.country) return null;
    if (e.countryCode && regionNames) { try { return regionNames.of(e.countryCode); } catch (err) { /* fall through */ } }
    return e.country;
  }

  function phaseLabel(d) { return d.label || t("phase." + d.phase); }

  function latestAcceptance(v) {
    const list = (v.type === "conference" ? v.conference.acceptance : v.journal.acceptance) || [];
    return list.filter((a) => a.rate != null).sort((a, b) => b.year - a.year)[0] || null;
  }

  function coreRank(v) { return v.conference && v.conference.rank && v.conference.rank.core ? v.conference.rank.core.value : null; }

  function latestOf(list) { return (list || []).slice().sort((a, b) => (b.year || 0) - (a.year || 0))[0] || null; }
  function latestSjr(v) { return latestOf(((v.journal || {}).metrics || {}).sjr); }

  function rankClass(r) {
    return { "A*": "r-astar", A: "r-a", B: "r-b", C: "r-c", Q1: "q-q1", Q2: "q-q2", Q3: "q-q3", Q4: "q-q4" }[r] || "";
  }

  function typeBadge(v) {
    return v.type === "conference"
      ? `<span class="badge badge-conf">${esc(t("type.conference"))}</span>`
      : `<span class="badge badge-journal">${esc(t("type.journal"))}</span>`;
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
    const [c, j, tg, m] = await Promise.all([get(DATA_FILES.conf), get(DATA_FILES.jour), get(DATA_FILES.tags), get(DATA_FILES.meta)]);
    meta = m;
    tags = tg.tags;
    tags.forEach((x) => tagById.set(x.id, Object.assign({ children: [] }, x)));
    tags.forEach((x) => { if (x.parent && tagById.has(x.parent)) tagById.get(x.parent).children.push(x.id); });
    venues = [].concat(c.venues, j.venues);
    venues.forEach((v) => {
      byId.set(v.id, v);
      const parts = [v.name, v.acronym, v.id, ...(v.tags || []).map(tagLabel), ...(v.tags || []),
        v.topics && v.topics.intro, ...((v.topics && v.topics.items) || []), v.topics && v.topics.text];
      (v.tags || []).forEach((id) => { const lbl = (tagById.get(id) || {}).label; if (lbl && typeof lbl === "object") parts.push(lbl.en); });
      if (v.type === "conference") {
        const e = v.conference.edition || {};
        parts.push(e.city, e.country, countryName(e), e.label, coreRank(v));
      } else {
        const jj = v.journal;
        parts.push(jj.publisher, jj.society, jj.issn && jj.issn.print, jj.issn && jj.issn.online);
        (jj.specialIssues || []).forEach((s) => parts.push(s.title));
      }
      v._search = parts.filter(Boolean).join(" \u0001 ").toLowerCase();
    });
    compare = new Set([...compare].filter((id) => byId.has(id)));
    state.tags = state.tags.filter((id) => tagById.has(id));
  }

  // ---------------------------------------------------------------- tag tree (hierarchical selection)
  // The selection is stored normalized: a selected tag implies all of its descendants,
  // so a selected tag never has a selected ancestor, and a tag whose visible children
  // are all selected is replaced by the tag itself.
  let visibleChildren = new Map();

  function normalizeTags(list) {
    const set = new Set(list);
    for (const id of [...set]) if (ancestors(id).some((a) => set.has(a))) set.delete(id);
    let changed = true;
    while (changed) {
      changed = false;
      for (const [id, kids] of visibleChildren) {
        if (!set.has(id) && kids.length && kids.every((k) => set.has(k))) {
          kids.forEach((k) => set.delete(k));
          set.add(id);
          changed = true;
        }
      }
    }
    return [...set];
  }

  function isTagChecked(id, set) { return set.has(id) || ancestors(id).some((a) => set.has(a)); }
  function isTagPartial(id, set) { return !isTagChecked(id, set) && [...descendants(id)].some((d) => d !== id && set.has(d)); }

  function toggleTag(id) {
    const set = new Set(state.tags);
    if (isTagChecked(id, set)) {
      if (set.has(id)) set.delete(id);
      else {
        // An ancestor is selected: replace it with the siblings along the path, excluding `id`'s branch.
        const chain = [id, ...ancestors(id)];
        const top = chain.findIndex((x) => set.has(x));
        set.delete(chain[top]);
        for (let i = top; i > 0; i--) {
          (visibleChildren.get(chain[i]) || []).forEach((c) => { if (c !== chain[i - 1]) set.add(c); });
        }
      }
    } else {
      descendants(id).forEach((d) => set.delete(d));
      set.add(id);
    }
    state.tags = normalizeTags([...set]);
    update();
  }

  // ---------------------------------------------------------------- filters UI
  function buildFilters() {
    const counts = new Map();
    tags.forEach((x) => {
      const d = descendants(x.id);
      counts.set(x.id, venues.filter((v) => v.tags.some((y) => d.has(y))).length);
    });
    visibleChildren = new Map(tags.map((x) => [x.id, tagById.get(x.id).children.filter((k) => counts.get(k) > 0)]));
    state.tags = normalizeTags(state.tags);
    const collapsed = store.get("vf-tree", {});
    function node(id) {
      const kids = visibleChildren.get(id);
      const isCollapsed = collapsed[id] !== false; // collapsed by default
      const label = tagLabel(id);
      return `<li data-tag="${esc(id)}" data-collapsed="${kids.length ? isCollapsed : "true"}">
        <div class="tag-row">
          <button type="button" class="twisty ${kids.length ? "" : "leaf"}" aria-label="${esc(t("f.expand", { name: label }))}" aria-expanded="${kids.length ? !isCollapsed : "false"}" ${kids.length ? "" : 'tabindex="-1" aria-hidden="true"'}>▶</button>
          <label class="check" style="flex:1"><input type="checkbox" value="${esc(id)}"> ${esc(label)} <span class="count">${counts.get(id)}</span></label>
        </div>
        ${kids.length ? `<ul>${kids.map(node).join("")}</ul>` : ""}
      </li>`;
    }
    $("#tag-tree").innerHTML = tags.filter((x) => !x.parent && counts.get(x.id) > 0).map((x) => node(x.id)).join("");
    $("#tag-tree").addEventListener("click", (e) => {
      const tw = e.target.closest(".twisty");
      if (!tw || tw.classList.contains("leaf")) return;
      const li = tw.closest("li");
      const nowCollapsed = li.dataset.collapsed !== "true";
      li.dataset.collapsed = String(nowCollapsed);
      tw.setAttribute("aria-expanded", String(!nowCollapsed));
      collapsed[li.dataset.tag] = nowCollapsed;
      store.set("vf-tree", collapsed);
    });
    $("#tag-tree").addEventListener("change", (e) => {
      if (e.target.type === "checkbox") toggleTag(e.target.value);
    });

    const countries = new Map();
    venues.filter((v) => v.type === "conference").forEach((v) => {
      const e = v.conference.edition || {};
      if (e.countryCode) countries.set(e.countryCode, countryName(e));
    });
    $("#f-country").insertAdjacentHTML("beforeend", [...countries].sort((a, b) => a[1].localeCompare(b[1], I18N.locale()))
      .map(([code, name]) => `<option value="${esc(code)}">${esc(name)}</option>`).join(""));

    const rankOpts = [["A*", "A*"], ["A", "A"], ["B", "B"], ["C", "C"], ["other", t("f.rankOther")]];
    $("#f-rank").innerHTML = rankOpts.map(([v, l]) => `<label class="check"><input type="checkbox" value="${v}"> ${esc(l)}</label>`).join("");
    const qOpts = [["Q1", "Q1"], ["Q2", "Q2"], ["Q3", "Q3"], ["Q4", "Q4"], ["na", t("f.qNA")]];
    $("#f-quartile").innerHTML = qOpts.map(([v, l]) => `<label class="check"><input type="checkbox" value="${v}"> ${esc(l)}</label>`).join("");

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
    if ($("#f-country").value !== state.country) state.country = ""; // value saved by an older data format
    $("#f-deadline").value = state.deadline;
    $("#f-oa").value = state.oa;
    $("#f-si").checked = state.si;
    $$("#f-rank input").forEach((i) => { i.checked = state.ranks.includes(i.value); });
    $$("#f-quartile input").forEach((i) => { i.checked = state.quartiles.includes(i.value); });
    const set = new Set(state.tags);
    $$("#tag-tree input").forEach((i) => {
      i.checked = isTagChecked(i.value, set);
      i.indeterminate = isTagPartial(i.value, set);
    });
    $("#conf-filters").hidden = state.type === "journal";
    $("#journal-filters").hidden = state.type === "conference";
  }

  // ---------------------------------------------------------------- filtering & sorting
  function applyFilters(now) {
    const tokens = state.q.toLowerCase().split(/\s+/).filter(Boolean);
    const tagSet = new Set();
    state.tags.forEach((x) => descendants(x).forEach((d) => tagSet.add(d)));
    const confActive = !!(state.country || state.ranks.length || state.deadline);
    const jourActive = !!(state.quartiles.length || state.oa || state.si);

    return venues.filter((v) => {
      if (state.type !== "all" && v.type !== state.type) return false;
      if (tokens.length && !tokens.every((x) => v._search.includes(x))) return false;
      if (tagSet.size && !v.tags.some((x) => tagSet.has(x))) return false;
      if (v.type === "conference") {
        // Journal-only filters exclude conferences unless conference filters are active too.
        if (jourActive && !confActive) return false;
        const e = v.conference.edition || {};
        if (state.country && e.countryCode !== state.country) return false;
        if (state.ranks.length) {
          const r = coreRank(v);
          if (!state.ranks.includes(r in CORE_ORDER ? r : "other")) return false;
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
          if (!state.quartiles.includes(s && s.quartile ? s.quartile : "na")) return false;
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

  function byName(a, b) { return (a.acronym || a.name).localeCompare(b.acronym || b.name, I18N.locale(), { sensitivity: "base" }); }

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

  // Groups avoid misleading mixed rankings (CORE vs SJR scales).
  function groupList(list, now) {
    if (state.sort === "rank" && state.type === "all") {
      return [
        { title: t("g.confTitle"), hint: t("g.confHint"), items: list.filter((v) => v.type === "conference") },
        { title: t("g.jourTitle"), hint: t("g.jourHint"), items: list.filter((v) => v.type === "journal") },
      ].filter((g) => g.items.length);
    }
    if (state.sort === "deadline") {
      const withDl = list.filter((v) => nextDeadlineUtc(v, now) !== Infinity);
      const without = list.filter((v) => nextDeadlineUtc(v, now) === Infinity);
      return [
        { title: t("g.upcoming"), hint: t("g.upcomingHint"), items: withDl },
        { title: t("g.none"), hint: t("g.noneHint"), items: without },
      ].filter((g) => g.items.length);
    }
    if (state.sort === "acceptance") {
      return [
        { title: t("g.accYes"), hint: t("g.accYesHint"), items: list.filter((v) => latestAcceptance(v)) },
        { title: t("g.accNo"), hint: "", items: list.filter((v) => !latestAcceptance(v)) },
      ].filter((g) => g.items.length);
    }
    return [{ title: null, items: list }];
  }

  // ---------------------------------------------------------------- list rendering
  function deadlineCell(v, now) {
    const r = resolved(v, now);
    if (v.type === "journal") {
      if (r.next) {
        return `<div><span class="badge badge-official">${esc(t("dl.specialIssue"))}</span></div>
          <div class="big">${esc(VT.formatDateStr(r.next.deadline.date))}</div>
          <div class="countdown" data-utc="${r.next.utc}">${esc(VT.formatCountdown(r.next.utc - now))}</div>
          <div class="faint">${esc(t("dl.alsoOpen"))}</div>`;
      }
      return `<div class="big">${esc(t("dl.alwaysOpen"))}</div><div class="faint">${esc(t("dl.noSI"))}</div>`;
    }
    if (r.status === "rolling") return `<div class="big">${esc(t("dl.rolling"))}</div><div class="faint">${esc(t("dl.rollingHint"))}</div>`;
    if (!r.next) {
      if (r.status === "closed-unknown") return `<div><span class="badge badge-closed">${esc(t("badge.closed"))}</span></div><div class="na">${esc(t("dl.nextNA"))}</div>`;
      return NA();
    }
    const n = r.next;
    return `<div>${n.estimated ? `<span class="badge badge-est">${esc(t("badge.estimated"))}</span>` : `<span class="badge badge-official">${esc(t("badge.official"))}</span>`} <span class="faint">${esc(phaseLabel(n))}</span></div>
      <div class="big ${n.estimated ? "est" : ""}">${n.estimated ? "~ " : ""}${esc(VT.formatDateStr(n.date))}</div>
      <div class="countdown ${n.estimated ? "est" : ""}" data-utc="${n.utc}">${esc(VT.formatCountdown(n.utc - now))}</div>`;
  }

  function rankCell(v) {
    if (v.type === "conference") {
      const c = v.conference.rank.core;
      if (!c || !c.value) return `<span class="badge badge-na">${esc(t("rank.notInCore"))}</span>`;
      return `<span class="badge badge-rank ${rankClass(c.value)}">${esc(c.value)}</span><div class="faint">${esc(t("rank.core", { edition: c.edition }))}</div>`;
    }
    const s = latestSjr(v);
    const jif = latestOf(v.journal.metrics.jif);
    if (!s) return `<span class="badge badge-na">${esc(t("badge.na"))}</span>`;
    return `<span class="badge badge-rank ${rankClass(s.quartile)}">${esc(s.quartile || t("badge.na"))}</span>
      <div class="faint">SJR ${s.value != null ? nf3.format(s.value) : esc(t("na.short"))} (${s.year})</div>
      ${jif ? `<div class="faint">IF ${nf1.format(jif.value)} (${jif.year})</div>` : ""}`;
  }

  function accCell(v) {
    const a = latestAcceptance(v);
    if (!a) return `<span class="na">${esc(t("na.short"))}</span>`;
    const rate = nf1.format(a.rate) + "%";
    return `<div title="${esc(t("acc.title", { rate, year: a.year }))}"><div class="big">${rate}</div><div class="faint">${esc(t("acc.inYear", { year: a.year }))}</div></div>`;
  }

  function eventDates(e) {
    if (!e.start) return null;
    return e.end && e.end !== e.start ? `${VT.formatDateStr(e.start)} – ${VT.formatDateStr(e.end)}` : VT.formatDateStr(e.start);
  }

  function subLine(v) {
    if (v.type === "conference") {
      const e = v.conference.edition || {};
      const place = [e.city, countryName(e)].filter(Boolean).join(", ");
      const dates = eventDates(e);
      return `<span>${esc(e.label || "")}</span>
        <span>${ICON_PIN} ${place ? esc(place) : `<span class="na">${esc(t("place.na"))}</span>`}</span>
        <span>${ICON_CAL} ${dates ? esc(dates) : `<span class="na">${esc(t("dates.na"))}</span>`}</span>`;
    }
    const j = v.journal;
    const issn = [j.issn.print && `p ${j.issn.print}`, j.issn.online && `e ${j.issn.online}`].filter(Boolean).join(" · ");
    const acc = { open: `<span class="badge badge-oa">${esc(t("access.open"))}</span>`, hybrid: esc(t("access.hybrid")), subscription: esc(t("access.subscription")) }[j.access] || "";
    return `<span>${esc(j.publisher)}</span><span class="mono">ISSN ${esc(issn)}</span><span>${acc}</span>`;
  }

  function rowHtml(v, now) {
    const tagChips = v.tags.slice(0, 4).map((x) => `<span class="chip">${esc(tagLabel(x))}</span>`).join("");
    return `<article class="row ${v.type}" data-id="${esc(v.id)}">
      <div class="row-main">
        <div class="row-title">${typeBadge(v)}
          <button class="open-btn" type="button" data-open="${esc(v.id)}"><span class="acr">${esc(v.acronym || v.name)}</span></button>
          <span class="name">${esc(v.acronym ? v.name : "")}</span>
        </div>
        <div class="row-sub">${subLine(v)}</div>
        <div class="chips">${tagChips}</div>
      </div>
      <div class="cell cell-rank"><span class="cell-label">${esc(t(v.type === "conference" ? "cell.rank" : "cell.metrics"))}</span>${rankCell(v)}</div>
      <div class="cell cell-dl"><span class="cell-label">${esc(t("col.deadline"))}</span>${deadlineCell(v, now)}</div>
      <div class="cell cell-acc"><span class="cell-label">${esc(t("col.acceptance"))}</span>${accCell(v)}</div>
      <div class="compare-cell"><input type="checkbox" aria-label="${esc(t("cmp.add", { name: v.acronym || v.name }))}" data-compare="${esc(v.id)}" ${compare.has(v.id) ? "checked" : ""}></div>
    </article>`;
  }

  function renderList() {
    const now = Date.now();
    resolveCache = new Map();
    const list = sortList(applyFilters(now), now);
    const groups = groupList(list, now);
    const nConf = list.filter((v) => v.type === "conference").length;
    $("#count").textContent = t("count", { n: list.length, c: nConf, j: list.length - nConf });
    if (!list.length) {
      $("#results").innerHTML = `<div class="empty">${esc(t("empty"))} <button class="btn" type="button" id="empty-reset">${esc(t("f.reset"))}</button></div>`;
      $("#empty-reset").addEventListener("click", () => $("#reset-btn").click());
      return;
    }
    const heads = `<div class="col-heads" aria-hidden="true"><span>${esc(t("col.venue"))}</span><span>${esc(t("col.rank"))}</span><span>${esc(t("col.deadline"))}</span><span class="h-acc">${esc(t("col.acceptance"))}</span><span></span></div>`;
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
  function timelineHtml(list, now, nextUtc) {
    return `<ul class="timeline">${list.map((d) => {
      const isNext = nextUtc && d.utc === nextUtc && VT.SUBMISSION_PHASES.includes(d.phase);
      const tzNote = d.tzStated === false ? ` <span class="faint" title="${esc(t("tz.notStatedTitle"))}">${esc(t("tz.notStated"))}</span>` : "";
      const right = d.past ? `<span class="badge badge-closed">${esc(t("badge.closed"))}</span>`
        : `<span class="countdown ${d.estimated ? "est" : ""}" data-utc="${d.utc}" data-sec="1">${esc(VT.formatCountdown(d.utc - now, true))}</span>`;
      const badge = d.estimated ? `<span class="badge badge-est">${esc(t("badge.estimated"))}</span>` : `<span class="badge badge-official">${esc(t("badge.official"))}</span>`;
      return `<li class="${d.past ? "past" : ""} ${d.estimated ? "estimated" : ""} ${isNext ? "next" : ""}">
        <span class="dot" aria-hidden="true"></span>
        <div><div class="tl-label">${esc(phaseLabel(d))} ${badge}${d.cycle ? ` <span class="chip">${esc(d.cycle)}</span>` : ""}</div>
          <div class="tl-when">${d.estimated ? "~ " : ""}${esc(VT.formatOriginal(d))}${tzNote}</div>
          <div class="tl-when faint">${esc(t("time.local", { t: VT.formatLocal(d.utc) }))}</div>
          ${d.source ? `<div>${srcHtml(d.source)}</div>` : ""}</div>
        <div class="tl-right">${right}</div>
      </li>`;
    }).join("")}</ul>`;
  }

  function acceptanceSection(list, title) {
    if (!list || !list.length) return `<section class="section"><h3>${esc(title)}</h3><p class="na">${esc(t("d.accNA"))}</p></section>`;
    const sorted = list.slice().sort((a, b) => a.year - b.year);
    const chart = window.VCharts.history(sorted.map((a) => ({ x: a.year, y: a.rate, submitted: a.submitted, accepted: a.accepted })),
      { unit: "%", label: t("chart.acc"), decimals: 1, locale: I18N.locale(),
        submittedLabel: t("d.submitted").toLowerCase(), acceptedLabel: t("d.accepted").toLowerCase() });
    const naCell = `<span class="na">${esc(t("na.short"))}</span>`;
    return `<section class="section"><h3>${esc(title)}</h3>
      ${chart || `<p class="faint">${esc(t("d.oneYearOnly"))}</p>`}
      ${chart && sorted.some((a) => a.submitted) ? `<p class="faint" style="font-size:12px;margin:0">${esc(t("d.chartLegend"))}</p>` : ""}
      <div class="table-wrap"><table class="data"><thead><tr><th>${esc(t("d.year"))}</th><th>${esc(t("d.rate"))}</th><th>${esc(t("d.submitted"))}</th><th>${esc(t("d.accepted"))}</th><th>${esc(t("d.source"))}</th></tr></thead><tbody>
      ${sorted.slice().reverse().map((a) => `<tr><td>${a.year}${a.track ? ` <span class="chip">${esc(a.track)}</span>` : ""}</td>
        <td class="num">${a.rate != null ? nf1.format(a.rate) + "%" : naCell}</td>
        <td class="num">${a.submitted ? nfInt.format(a.submitted) : naCell}</td>
        <td class="num">${a.accepted ? nfInt.format(a.accepted) : naCell}</td>
        <td>${srcHtml(a.source, "")}${a.note ? `<div class="faint" style="font-size:12px">${esc(a.note)}</div>` : ""}</td></tr>`).join("")}
      </tbody></table></div></section>`;
  }

  function topicsSection(v, title) {
    const tp = v.topics || {};
    let body = "";
    if (tp.intro) body += `<p>${esc(tp.intro)}</p>`;
    if (tp.items && tp.items.length) body += `<ul class="topic-list">${tp.items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`;
    if (tp.text) body += `<div class="scope-text">${tp.text.split("\n").map((p) => `<p>${esc(p)}</p>`).join("")}</div>`;
    if (!body) body = `<p class="na">${esc(t("na"))}</p>`;
    return `<section class="section highlight"><h3>${esc(title)}</h3>${body}<div>${srcHtml(tp.source)}</div></section>`;
  }

  function factHtml(label, value, source) {
    return `<div class="fact"><dt>${esc(label)}</dt><dd>${value == null || value === "" ? NA() : value}${source ? `<div>${srcHtml(source, null, true)}</div>` : ""}</dd></div>`;
  }

  function conferenceDetail(v, now) {
    const c = v.conference;
    const e = c.edition || {};
    const r = resolved(v, now);
    const place = [e.city, countryName(e)].filter(Boolean).join(", ");
    const dates = eventDates(e);
    const core = c.rank.core || {};
    const rankVal = core.value ? `<span class="badge badge-rank ${rankClass(core.value)}">${esc(core.value)}</span> <span class="faint">${esc(core.edition)}</span>${core.previous ? ` <span class="faint">(${esc(core.previous.edition)}: ${esc(core.previous.value)})</span>` : ""}` : null;
    const coreSrc = core.url ? { url: core.url, verified: core.verified, note: core.note } : null;
    const lastAcc = latestAcceptance(v);

    let dlBlock = "";
    if (r.status === "rolling") {
      dlBlock = `<p><strong>${esc(t("d.rollingText"))}</strong></p>`;
    } else {
      if (r.official.length) {
        dlBlock += `<p class="faint" style="margin:0 0 6px">${esc(t("d.officialOf", { edition: e.label || t("d.thisEdition") }))}</p>`
          + timelineHtml(r.official, now, r.next && !r.next.estimated ? r.next.utc : null);
      } else {
        dlBlock += `<p class="na">${esc(t("d.noOfficial", { edition: e.label || "" }))}</p>`;
      }
      if (r.estimated.length) {
        const note = t("d.estNote", { basis: esc(r.basis || t("d.prevCycle")), years: esc(t(c.recurrence === 2 ? "d.twoYears" : "d.oneYear")) });
        dlBlock += `<div class="note warn" style="margin:14px 0 8px">${note}</div>` + timelineHtml(r.estimated, now, r.next && r.next.estimated ? r.next.utc : null);
      } else if (r.status === "closed-unknown" || (!r.official.length && r.status === "unknown")) {
        dlBlock += `<p class="na" style="margin-top:8px">${esc(t("d.noEstimate"))}</p>`;
      }
    }

    const ws = c.workshops || {};
    const wsDeadlines = (ws.deadlines || []).map((d) => { const utc = VT.deadlineUtc(d); return Object.assign({}, d, { utc, past: utc < now }); });
    const wsItems = ws.items || [];
    const wsList = wsItems.length ? `<details ${wsItems.length <= 8 ? "open" : ""}><summary>${esc(t("d.wsCount", { n: wsItems.length }))}</summary><ul class="ws-list">${wsItems.map((w) =>
        `<li><strong>${w.url ? `<a href="${esc(w.url)}" target="_blank" rel="noopener">${esc(w.name)}</a>` : esc(w.name)}</strong>${w.when ? ` <span class="faint">· ${esc(w.when)}</span>` : ""}${w.topics ? `<div class="muted" style="font-size:13px">${esc(w.topics)}</div>` : ""}${w.deadline ? `<div class="faint">${esc(t("d.deadlineLabel", { d: VT.formatOriginal(w.deadline) }))}</div>` : ""}</li>`).join("")}</ul></details>` : "";
    const wsBody = (ws.note ? `<p>${esc(ws.note)}</p>` : "")
      + (wsDeadlines.length ? timelineHtml(wsDeadlines, now, null) : "")
      + wsList
      + (ws.url ? `<p><a href="${esc(ws.url)}" target="_blank" rel="noopener">${esc(t("d.wsPage"))}</a></p>` : "")
      + (ws.source ? `<div>${srcHtml(ws.source)}</div>` : "");
    const p = c.proceedings || {};

    return `
      <section class="section"><dl class="facts">
        ${factHtml(t("d.edition"), esc(e.label), e.source)}
        ${factHtml(t("d.location"), place ? esc(place) + (e.format && e.format !== "in-person" ? ` (${esc(e.format)})` : "") : null)}
        ${factHtml(t("d.dates"), dates ? esc(dates) : null)}
        ${factHtml(t("d.coreRank"), rankVal, coreSrc)}
        ${factHtml(t("d.lastAcc"), lastAcc ? `${nf1.format(lastAcc.rate)}% <span class="faint">(${lastAcc.year})</span>` : null)}
        ${factHtml(t("d.cadence"), esc(t(c.recurrence === 2 ? "d.biennial" : "d.annual")))}
      </dl>
      ${e.note ? `<p class="note" style="margin-top:10px">${esc(e.note)}</p>` : ""}</section>
      ${topicsSection(v, t("d.topicsConf"))}
      <section class="section"><h3>${esc(t("d.deadlines"))}</h3>${dlBlock}</section>
      <section class="section"><h3>${esc(t("d.workshops"))}</h3>${wsBody || `<p class="na">${esc(t("d.wsNA"))}</p>`}</section>
      <section class="section"><h3>${esc(t("d.proceedings"))}</h3>
        <dl class="facts">
          ${factHtml(t("d.publisher"), esc(p.publisher))}
          ${factHtml(t("d.series"), esc(p.series))}
          ${factHtml(t("d.indexing"), p.indexing && p.indexing.length ? esc(p.indexing.join(", ")) : null)}
          ${factHtml(t("d.access"), p.openAccess === true ? esc(t("d.procOA")) : p.openAccess === false ? esc(t("d.procNotOA")) : null)}
        </dl>
        ${p.url ? `<p><a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(t("d.procLink"))}</a></p>` : ""}
      </section>
      ${acceptanceSection(c.acceptance, t("d.accHistory"))}`;
  }

  function journalDetail(v, now) {
    const j = v.journal;
    const r = resolved(v, now);
    const s = latestSjr(v);
    const jif = latestOf(j.metrics.jif);
    const cs = latestOf(j.metrics.citescore);
    const accLbl = { open: `<span class="badge badge-oa">${esc(t("access.openLong"))}</span>`, hybrid: esc(t("access.hybridLong")), subscription: esc(t("access.subscription")) }[j.access];
    const apc = j.apc
      ? (j.apc.amount != null ? (j.apc.amount === 0 ? esc(t("d.noApc")) : `${nfInt.format(j.apc.amount)} ${esc(j.apc.currency || "")}`) : "")
        + (j.apc.note ? `<div class="faint" style="font-weight:400">${esc(j.apc.note)}</div>` : "")
      : null;
    const idx = j.indexing || {};
    const yn = (x) => (x === true ? esc(t("d.yes")) : x === false ? esc(t("d.no")) : `<span class="na">${esc(t("na.short"))}</span>`);
    const naCell = `<span class="na">${esc(t("na.short"))}</span>`;

    const sjrPts = (j.metrics.sjr || []).filter((x) => x.value != null).map((x) => ({ x: x.year, y: x.value }));
    const jifPts = (j.metrics.jif || []).filter((x) => x.year).map((x) => ({ x: x.year, y: x.value }));
    const metricRows = [].concat(
      (j.metrics.sjr || []).map((x) => ({ k: t("m.sjr"), year: x.year, val: x.value != null ? nf3.format(x.value) : naCell, extra: x.quartile ? `<span class="badge badge-rank ${rankClass(x.quartile)}">${esc(x.quartile)}</span>` : "", src: x.source })),
      (j.metrics.jif || []).map((x) => ({ k: t("m.jif"), year: x.year, val: nf1.format(x.value), extra: "", src: x.source })),
      (j.metrics.citescore || []).map((x) => ({ k: t("m.citescore"), year: x.year, val: nf1.format(x.value), extra: "", src: x.source })),
    ).sort((a, b) => a.k.localeCompare(b.k) || (b.year || 0) - (a.year || 0));
    const charts = (sjrPts.length >= 2 ? `<p class="faint" style="margin:6px 0 0">${esc(t("d.sjrTrend"))}</p>${window.VCharts.history(sjrPts, { label: t("d.sjrTrend"), decimals: 3, locale: I18N.locale() })}` : "")
      + (jifPts.length >= 2 ? `<p class="faint" style="margin:6px 0 0">${esc(t("d.jifTrend"))}</p>${window.VCharts.history(jifPts, { label: t("d.jifTrend"), decimals: 1, locale: I18N.locale() })}` : "");

    const siHtml = r.specialIssues.length ? `<ul class="timeline">${r.specialIssues.map((si) => `<li class="${si.past ? "past" : ""}">
        <span class="dot" aria-hidden="true"></span>
        <div><div class="tl-label"><a href="${esc(si.url)}" target="_blank" rel="noopener">${esc(si.title)}</a></div>
          ${si.deadline ? `<div class="tl-when">${esc(t("d.deadlineLabel", { d: VT.formatOriginal(si.deadline) }))}${si.deadline.tzStated === false ? ` <span class="faint">${esc(t("tz.notStated"))}</span>` : ""}</div><div class="tl-when faint">${esc(t("time.local", { t: VT.formatLocal(si.utc) }))}</div>` : ""}
          <div>${srcHtml(si.source)}</div></div>
        <div class="tl-right">${si.past ? `<span class="badge badge-closed">${esc(t("badge.closed"))}</span>` : `<span class="countdown" data-utc="${si.utc}" data-sec="1">${esc(VT.formatCountdown(si.utc - now, true))}</span>`}</div>
      </li>`).join("")}</ul><p class="faint" style="font-size:12px">${esc(t("d.siNever"))}</p>` : `<p class="na">${esc(t("d.siNone"))}</p>`;

    const issn = [j.issn.print && `${esc(t("d.print"))} ${esc(j.issn.print)}`, j.issn.online && `${esc(t("d.online"))} ${esc(j.issn.online)}`].filter(Boolean).join("<br>");
    return `
      <section class="section"><dl class="facts">
        ${factHtml(t("d.issn"), `<span class="mono">${issn}</span>`)}
        ${factHtml(t("d.publisher"), esc(j.publisher) + (j.society ? `<div class="faint" style="font-weight:400">${esc(j.society)}</div>` : ""))}
        ${factHtml(t("d.quartile"), s && s.quartile ? `<span class="badge badge-rank ${rankClass(s.quartile)}">${esc(s.quartile)}</span> <span class="faint">${s.year}</span>` : null)}
        ${factHtml(t("d.sjr"), s && s.value != null ? `${nf3.format(s.value)} <span class="faint">(${s.year})</span>` : null)}
        ${factHtml(t("d.jif"), jif ? `${nf1.format(jif.value)} <span class="faint">(JIF ${jif.year})</span>` : null)}
        ${factHtml(t("d.citescore"), cs ? `${nf1.format(cs.value)} <span class="faint">(${cs.year || esc(t("d.yearNA"))})</span>` : null)}
        ${factHtml(t("d.model"), accLbl)}
        ${factHtml(t("d.apc"), apc, j.apc && j.apc.source)}
        ${factHtml(t("d.submission"), esc(t("d.alwaysOpenLong")))}
      </dl></section>
      ${topicsSection(v, t("d.topicsJournal"))}
      <section class="section"><h3>${esc(t("d.si"))}</h3>${siHtml}</section>
      <section class="section"><h3>${esc(t("d.metrics"))}</h3>
        ${charts || `<p class="faint">${esc(t("d.metricsNoHistory"))}</p>`}
        <div class="table-wrap"><table class="data"><thead><tr><th>${esc(t("d.metric"))}</th><th>${esc(t("d.year"))}</th><th>${esc(t("d.value"))}</th><th>${esc(t("d.source"))}</th></tr></thead><tbody>
          ${metricRows.length ? metricRows.map((m) => `<tr><td>${esc(m.k)} ${m.extra}</td><td>${m.year || naCell}</td><td class="num">${m.val}</td><td>${srcHtml(m.src, "")}</td></tr>`).join("") : `<tr><td colspan="4" class="na">${esc(t("d.noMetrics"))}</td></tr>`}
        </tbody></table></div>
      </section>
      <section class="section"><h3>${esc(t("d.indexingTitle"))}</h3>
        <dl class="facts">${factHtml("Scopus", yn(idx.scopus))}${factHtml("Web of Science", yn(idx.wos))}${factHtml("DOAJ", yn(idx.doaj))}</dl>
        ${idx.note ? `<p class="faint" style="font-size:13px">${esc(idx.note)}</p>` : ""}
      </section>
      <section class="section"><h3>${esc(t("d.review"))}</h3>
        ${j.review ? `<p>${esc(j.review.text)}</p>${srcHtml(j.review.source)}` : `<p class="na">${esc(t("d.reviewNA"))}</p>`}
      </section>
      ${acceptanceSection(j.acceptance, t("d.accJournal"))}
      ${j.submitUrl ? `<p><a href="${esc(j.submitUrl)}" target="_blank" rel="noopener">${esc(t("d.submitPortal"))}</a></p>` : ""}`;
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
    const sources = [...collectSources(v, new Map()).values()];
    const drawer = $("#drawer");
    drawer.innerHTML = `
      <div class="drawer-head ${v.type}">
        <div>
          <div>${typeBadge(v)} ${v.tags.map((x) => `<span class="chip">${esc(tagLabel(x))}</span>`).join(" ")}</div>
          <h2 id="drawer-title">${esc(v.acronym ? v.acronym + " — " : "")}${esc(v.name)}</h2>
          <div style="margin-top:4px"><a href="${esc(v.website)}" target="_blank" rel="noopener">${esc(t("d.website"))}</a>
            · <label class="check" style="display:inline-flex"><input type="checkbox" data-compare="${esc(v.id)}" ${compare.has(v.id) ? "checked" : ""}> ${esc(t("d.compare"))}</label></div>
        </div>
        <button class="icon-btn close" type="button" id="drawer-close" aria-label="${esc(t("d.close"))}">✕</button>
      </div>
      <div class="drawer-body">
        ${v.type === "conference" ? conferenceDetail(v, now) : journalDetail(v, now)}
        ${v.notes ? `<section class="section"><h3>${esc(t("d.notes"))}</h3><p class="note">${esc(v.notes)}</p></section>` : ""}
        <section class="section"><h3>${esc(t("d.allSources", { n: sources.length }))}</h3>
          <ol class="sources-list">${sources.map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.url)}</a> <span class="faint">— ${esc(t("src.verified", { date: VT.formatDateStr(s.verified) }))}</span></li>`).join("")}</ol>
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
        alert(t("cmp.max", { max: MAX_COMPARE }));
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
    $("#compare-tray").hidden = compare.size === 0;
    $("#compare-names").textContent = t("cmp.tray", { n: compare.size, max: MAX_COMPARE }) + " " + [...compare].map((id) => (byId.get(id) || {}).acronym || id).join(", ");
  }

  function openCompare() {
    const now = Date.now();
    resolveCache = new Map();
    const list = [...compare].map((id) => byId.get(id)).filter(Boolean);
    const row = (key, fn) => `<tr><th>${esc(t(key))}</th>${list.map((v) => `<td>${fn(v)}</td>`).join("")}</tr>`;
    const modal = $("#compare-modal");
    modal.innerHTML = `
      <div class="modal-head"><h2 id="compare-title">${esc(t("cmp.title"))}</h2>
        <span class="faint" style="font-size:13px">${esc(t("cmp.hint"))}</span>
        <button class="icon-btn" type="button" id="compare-close" style="margin-left:auto" aria-label="${esc(t("cmp.close"))}">✕</button></div>
      <div class="modal-body table-wrap"><table class="data compare-table"><thead><tr><th></th>${list.map((v) => `<th><button class="open-btn btn" type="button" data-open-cmp="${esc(v.id)}">${esc(v.acronym || v.name)}</button></th>`).join("")}</tr></thead><tbody>
        ${row("cmp.type", typeBadge)}
        ${row("cmp.name", (v) => esc(v.name))}
        ${row("cmp.areas", (v) => v.tags.map((x) => esc(tagLabel(x))).join(", "))}
        ${row("cmp.rank", rankCell)}
        ${row("cmp.deadline", (v) => deadlineCell(v, now))}
        ${row("cmp.acceptance", accCell)}
        ${row("cmp.edition", (v) => {
          if (v.type !== "conference") return esc(v.journal.publisher);
          const e = v.conference.edition;
          return esc([e.label, [e.city, countryName(e)].filter(Boolean).join(", ")].filter(Boolean).join(" · "));
        })}
        ${row("cmp.proceedings", (v) => v.type === "conference"
          ? esc([v.conference.proceedings.publisher, v.conference.proceedings.series].filter(Boolean).join(" — "))
          : esc(t({ open: "access.openLong", hybrid: "access.hybrid", subscription: "access.subscription" }[v.journal.access] || "na")))}
        ${row("cmp.review", (v) => (v.type === "journal" && v.journal.review ? esc(v.journal.review.text) : `<span class="na">${esc(t("na.short"))}</span>`))}
        ${row("cmp.site", (v) => `<a href="${esc(v.website)}" target="_blank" rel="noopener">${esc(domain(v.website))}</a>`)}
      </tbody></table></div>`;
    modal.hidden = false;
    $("#scrim").hidden = false;
    $("#compare-close").focus();
    $("#compare-close").addEventListener("click", closeCompare);
  }
  function closeCompare() {
    $("#compare-modal").hidden = true;
    if ($("#drawer").hidden) $("#scrim").hidden = true;
  }

  // ---------------------------------------------------------------- theme
  function initTheme() {
    const order = ["auto", "light", "dark"];
    const icons = { auto: "◐", light: "☀", dark: "☾" };
    let cur = "auto";
    try { cur = localStorage.getItem("vf-theme") || "auto"; } catch (e) { /* storage unavailable */ }
    if (!order.includes(cur)) cur = "auto";
    const apply = () => {
      if (cur === "auto") delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = cur;
      const name = t("theme." + cur);
      $("#theme-label").textContent = name;
      $("#theme-icon").textContent = icons[cur];
      $("#theme-btn").setAttribute("aria-label", t("theme.aria", { name }));
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
    $("#compare-modal").addEventListener("click", (e) => {
      const b = e.target.closest("[data-open-cmp]");
      if (b) { closeCompare(); openDetail(b.dataset.openCmp, true); }
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
    await I18N.load();
    const loc = I18N.locale();
    nf1 = new Intl.NumberFormat(loc, { maximumFractionDigits: 1 });
    nf3 = new Intl.NumberFormat(loc, { maximumFractionDigits: 3 });
    nfInt = new Intl.NumberFormat(loc);
    try { regionNames = new Intl.DisplayNames([loc], { type: "region" }); } catch (e) { regionNames = null; }
    initTheme();
    let tz = "";
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch (e) { /* ignore */ }
    try {
      await load();
    } catch (err) {
      $("#results").innerHTML = `<div class="empty"><strong>${esc(t("load.error"))}</strong><br>${esc(err.message)}<br><span class="faint">${esc(t("load.errorHint"))}</span></div>`;
      return;
    }
    $("#footer-text").textContent = t("footer", { date: VT.formatDateStr(meta.lastVerified), tz });
    buildFilters();
    bindGlobal();
    renderList();
    renderTray();
    routeFromHash();
    setInterval(tick, 1000);
  }

  main();
})();
