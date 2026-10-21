/* Tiny inline-SVG charts (no external libraries). */
(function () {
  "use strict";

  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  /*
   * History chart: optional bars (submitted vs accepted) plus a line for a value
   * (e.g. acceptance rate %, SJR, IF).
   *  points: [{ x: 2024, y: 25.8, submitted?: 15671, accepted?: 4037 }]
   *  opts:   { unit: "%", label: "Acceptance rate", decimals: 1, locale: "en-GB",
   *            submittedLabel: "submitted", acceptedLabel: "accepted" }
   */
  function history(points, opts) {
    opts = opts || {};
    const pts = points.filter((p) => p.y != null || p.submitted != null).sort((a, b) => a.x - b.x);
    if (pts.length < 2) return "";
    const W = 560, H = 190, padL = 44, padR = 44, padT = 16, padB = 26;
    const iw = W - padL - padR, ih = H - padT - padB;
    const n = pts.length;
    const xAt = (i) => padL + (n === 1 ? iw / 2 : (iw * i) / (n - 1));
    const ys = pts.filter((p) => p.y != null).map((p) => p.y);
    const yMax = ys.length ? Math.max(...ys) * 1.15 : 1;
    const yMin = 0;
    const yAt = (v) => padT + ih - ((v - yMin) / (yMax - yMin || 1)) * ih;
    const hasBars = pts.some((p) => p.submitted);
    const bMax = hasBars ? Math.max(...pts.map((p) => p.submitted || p.accepted || 0)) : 1;
    const bAt = (v) => padT + ih - (v / bMax) * ih;
    const bw = Math.min(34, iw / n / 2.4);
    const dec = opts.decimals != null ? opts.decimals : 1;
    const nf = new Intl.NumberFormat(opts.locale || "en-GB");
    const nfDec = new Intl.NumberFormat(opts.locale || "en-GB", { minimumFractionDigits: dec, maximumFractionDigits: dec });
    const nfAxis = (v) => new Intl.NumberFormat(opts.locale || "en-GB", { maximumFractionDigits: v < 10 ? 1 : 0 }).format(v);
    let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.label || "Trend")}">`;
    for (let k = 0; k <= 4; k++) {
      const v = yMin + ((yMax - yMin) * k) / 4;
      const y = yAt(v);
      s += `<line class="grid" x1="${padL}" x2="${W - padR}" y1="${y}" y2="${y}"/>`;
      s += `<text x="${padL - 6}" y="${y + 4}" text-anchor="end">${nfAxis(v)}${opts.unit || ""}</text>`;
      if (hasBars) s += `<text x="${W - padR + 6}" y="${bAt((bMax * k) / 4) + 4}">${nf.format(Math.round((bMax * k) / 4))}</text>`;
    }
    pts.forEach((p, i) => {
      const x = xAt(i);
      if (hasBars && p.submitted) {
        s += `<rect class="bar-sub" x="${x - bw}" y="${bAt(p.submitted)}" width="${bw}" height="${padT + ih - bAt(p.submitted)}"><title>${p.x}: ${nf.format(p.submitted)} ${esc(opts.submittedLabel || "submitted")}</title></rect>`;
      }
      if (hasBars && p.accepted) {
        s += `<rect class="bar-acc" x="${x}" y="${bAt(p.accepted)}" width="${bw}" height="${padT + ih - bAt(p.accepted)}"><title>${p.x}: ${nf.format(p.accepted)} ${esc(opts.acceptedLabel || "accepted")}</title></rect>`;
      }
      s += `<text x="${x}" y="${H - 8}" text-anchor="middle">${p.x}</text>`;
    });
    const lp = pts.map((p, i) => (p.y == null ? null : [xAt(i), yAt(p.y), p])).filter(Boolean);
    if (lp.length >= 2) s += `<polyline class="line" points="${lp.map((q) => q[0] + "," + q[1]).join(" ")}"/>`;
    lp.forEach((q) => {
      s += `<circle class="pt" cx="${q[0]}" cy="${q[1]}" r="4"><title>${q[2].x}: ${nfDec.format(q[2].y)}${opts.unit || ""}</title></circle>`;
      s += `<text x="${q[0]}" y="${q[1] - 9}" text-anchor="middle">${nfDec.format(q[2].y)}${opts.unit || ""}</text>`;
    });
    s += "</svg>";
    return s;
  }

  window.VCharts = { history };
})();
