/*
 * Deadline and time-zone logic (deterministic, browser-only).
 *
 * A deadline in the data looks like:
 *   { "phase": "paper", "date": "2026-05-06", "time": "23:59", "tz": "AoE" }
 * tz can be "AoE" (UTC-12), "UTC", or any IANA zone ("America/Los_Angeles").
 * When "time" is missing the deadline is the end of the day (23:59).
 */
(function () {
  "use strict";

  const SUBMISSION_PHASES = ["abstract", "paper", "commitment"];

  let locale = "en-GB";
  let fmtDate, fmtDateTimeLocal;
  let dayUnit = "d";
  let expiredLabel = "passed";
  let tzNames = {};

  function setLocale(loc, opts) {
    locale = loc;
    opts = opts || {};
    dayUnit = opts.dayUnit || "d";
    expiredLabel = opts.expired || "passed";
    tzNames = opts.tzNames || {};
    fmtDate = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" });
    fmtDateTimeLocal = new Intl.DateTimeFormat(locale, {
      day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short",
    });
  }
  setLocale(locale);

  // Offset (minutes) between a zone's wall clock and UTC at instant ts.
  function zoneOffsetMinutes(ts, tz) {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    const p = {};
    for (const part of fmt.formatToParts(new Date(ts))) p[part.type] = part.value;
    const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
    return Math.round((asUtc - ts) / 60000);
  }

  // Converts a wall-clock time in `tz` into a UTC timestamp (ms).
  function zonedToUtc(dateStr, timeStr, tz) {
    const [y, mo, d] = dateStr.split("-").map(Number);
    const [h, mi] = (timeStr || "23:59").split(":").map(Number);
    const wall = Date.UTC(y, mo - 1, d, h, mi, 59);
    if (!tz || tz === "AoE") return wall + 12 * 3600 * 1000;
    if (tz === "UTC") return wall;
    let utc = wall;
    for (let i = 0; i < 3; i++) utc = wall - zoneOffsetMinutes(utc, tz) * 60000;
    return utc;
  }

  function tzLabel(tz) {
    if (!tz || tz === "AoE") return "AoE (UTC−12)";
    if (tz === "UTC") return "UTC";
    return tzNames[tz] || tz;
  }

  function deadlineUtc(dl) {
    return zonedToUtc(dl.date, dl.time, dl.tz);
  }

  function shiftYears(dateStr, years) {
    const [y, m, d] = dateStr.split("-").map(Number);
    const ny = y + years;
    // 29 Feb -> 28 Feb on non-leap years
    let nd = d;
    if (m === 2 && d === 29 && !((ny % 4 === 0 && ny % 100 !== 0) || ny % 400 === 0)) nd = 28;
    return `${ny}-${String(m).padStart(2, "0")}-${String(nd).padStart(2, "0")}`;
  }

  function formatDateStr(dateStr) {
    if (!dateStr) return "";
    const [y, m, d] = dateStr.split("-").map(Number);
    return fmtDate.format(new Date(Date.UTC(y, m - 1, d, 12)));
  }

  function formatLocal(ts) {
    return fmtDateTimeLocal.format(new Date(ts));
  }

  function formatOriginal(dl) {
    return `${formatDateStr(dl.date)}, ${dl.time || "23:59"} ${tzLabel(dl.tz)}`;
  }

  function formatCountdown(ms, withSeconds) {
    if (ms <= 0) return expiredLabel;
    const s = Math.floor(ms / 1000);
    const d = Math.floor(s / 86400);
    const hh = String(Math.floor((s % 86400) / 3600)).padStart(2, "0");
    const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
    const ss = String(s % 60).padStart(2, "0");
    if (d > 0) return withSeconds ? `${d}${dayUnit} ${hh}h ${mm}m ${ss}s` : `${d}${dayUnit} ${hh}h ${mm}m`;
    return `${hh}h ${mm}m ${ss}s`;
  }

  /*
   * Resolves the deadline situation of a conference at instant `now`:
   *  - official: official deadlines (with utc + past flag)
   *  - next: next useful submission deadline ({...dl, utc, estimated})
   *  - status: "open" (official upcoming submission deadline),
   *            "estimated" (only an estimate from the previous cycle),
   *            "rolling", "closed-unknown" (all past, nothing to estimate),
   *            "unknown" (no data at all)
   *  - estimated: estimated deadlines for the next cycle (if any)
   *  - basis: label of the cycle the estimate is based on
   */
  function resolveConference(v, now) {
    const c = v.conference || {};
    const rec = c.recurrence || 1;
    const official = (c.deadlines || []).map((dl) => {
      const utc = deadlineUtc(dl);
      return Object.assign({}, dl, { utc, past: utc < now });
    }).sort((a, b) => a.utc - b.utc);

    const res = { official, estimated: [], next: null, status: "unknown", basis: null };
    if (c.rolling) { res.status = "rolling"; return res; }

    const futureSub = official.filter((d) => !d.past && SUBMISSION_PHASES.includes(d.phase));
    if (futureSub.length) {
      res.next = Object.assign({}, futureSub[0], { estimated: false });
      res.status = "open";
      return res;
    }

    // Base cycle for the estimate: official deadlines of the current edition,
    // or (if none are published yet) the previous cycle.
    let base = official.length ? official : null;
    let basis = base ? (c.edition && c.edition.label) : null;
    if (!base && c.previousCycle && (c.previousCycle.deadlines || []).length) {
      base = c.previousCycle.deadlines.map((dl) => Object.assign({}, dl, { utc: deadlineUtc(dl) }));
      basis = c.previousCycle.label;
    }
    if (!base) { res.status = official.length ? "closed-unknown" : "unknown"; return res; }

    const subs = base.filter((d) => SUBMISSION_PHASES.includes(d.phase));
    if (!subs.length) { res.status = "closed-unknown"; return res; }
    // Smallest shift (multiple of the recurrence) such that at least one
    // shifted submission deadline is still ahead.
    const lastSubUtc = (years) => Math.max(...subs.map((d) => deadlineUtc(Object.assign({}, d, { date: shiftYears(d.date, years) }))));
    let k = rec;
    let guard = 0;
    while (lastSubUtc(k) < now && guard++ < 20) k += rec;

    res.estimated = base.map((d) => {
      const nd = Object.assign({}, d, { date: shiftYears(d.date, k) });
      delete nd.source;
      nd.utc = deadlineUtc(nd);
      nd.past = nd.utc < now;
      nd.estimated = true;
      return nd;
    }).sort((a, b) => a.utc - b.utc);
    const nextEst = res.estimated.find((d) => !d.past && SUBMISSION_PHASES.includes(d.phase));
    res.next = nextEst ? Object.assign({}, nextEst, { estimated: true }) : null;
    res.basis = basis;
    res.status = res.next ? "estimated" : "closed-unknown";
    return res;
  }

  // Special issues: never estimated. Returns a sorted list with utc/past flags.
  function resolveSpecialIssues(v, now) {
    const j = v.journal || {};
    return (j.specialIssues || []).map((si) => {
      if (!si.deadline) return Object.assign({}, si, { utc: null, past: false });
      const utc = deadlineUtc(si.deadline);
      return Object.assign({}, si, { utc, past: utc < now });
    }).sort((a, b) => (a.utc ?? Infinity) - (b.utc ?? Infinity));
  }

  window.VT = {
    SUBMISSION_PHASES, setLocale,
    zonedToUtc, deadlineUtc, tzLabel, shiftYears,
    formatDateStr, formatLocal, formatOriginal, formatCountdown,
    resolveConference, resolveSpecialIssues,
  };
})();
