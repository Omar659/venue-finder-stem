/*
 * Minimal i18n layer.
 *
 * UI strings live in assets/i18n/<lang>.json (flat key -> string maps).
 * English is the default and the fallback for missing keys.
 * Language choice: ?lang=xx in the URL, then the saved preference, then English.
 * Static markup is translated through data-i18n / data-i18n-attr attributes.
 */
(function () {
  "use strict";

  const LANGUAGES = [
    { code: "en", name: "English", locale: "en-GB" },
    { code: "it", name: "Italiano", locale: "it-IT" },
    { code: "es", name: "Español", locale: "es-ES" },
    { code: "fr", name: "Français", locale: "fr-FR" },
    { code: "de", name: "Deutsch", locale: "de-DE" },
    { code: "pt", name: "Português", locale: "pt-PT" },
    { code: "zh", name: "中文", locale: "zh-CN" },
  ];
  const DEFAULT = "en";
  // Bump together with the ?v= query in index.html / guide.html when releasing,
  // so browsers never mix cached files from different versions.
  const ASSET_VERSION = "20261022a";
  const STORAGE_KEY = "vf-lang";

  let lang = DEFAULT;
  let dict = {};
  let fallback = {};

  function pickLanguage() {
    const fromUrl = new URLSearchParams(location.search).get("lang");
    if (fromUrl && LANGUAGES.some((l) => l.code === fromUrl)) return fromUrl;
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved && LANGUAGES.some((l) => l.code === saved)) return saved;
    } catch (e) { /* storage unavailable */ }
    return DEFAULT;
  }

  function t(key, params) {
    let s = dict[key] != null ? dict[key] : (fallback[key] != null ? fallback[key] : key);
    if (params) s = s.replace(/\{(\w+)\}/g, (m, k) => (params[k] != null ? params[k] : m));
    return s;
  }

  function locale() {
    return (LANGUAGES.find((l) => l.code === lang) || LANGUAGES[0]).locale;
  }

  // Translates static markup: data-i18n="key" sets textContent,
  // data-i18n-html="key" sets innerHTML (trusted bundled strings only),
  // data-i18n-attr="attr:key;attr2:key2" sets attributes.
  function applyStatic(root) {
    root = root || document;
    root.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
    root.querySelectorAll("[data-i18n-html]").forEach((el) => { el.innerHTML = t(el.dataset.i18nHtml); });
    root.querySelectorAll("[data-i18n-attr]").forEach((el) => {
      el.dataset.i18nAttr.split(";").forEach((pair) => {
        const [attr, key] = pair.split(":").map((s) => s.trim());
        if (attr && key) el.setAttribute(attr, t(key));
      });
    });
  }

  function initSelector() {
    const sel = document.getElementById("lang-select");
    if (!sel) return;
    sel.innerHTML = LANGUAGES.map((l) => `<option value="${l.code}" lang="${l.code}"${l.code === lang ? " selected" : ""}>${l.name}</option>`).join("");
    sel.addEventListener("change", () => {
      try { localStorage.setItem(STORAGE_KEY, sel.value); } catch (e) { /* ignore */ }
      const url = new URL(location.href);
      url.searchParams.delete("lang");
      location.href = url.toString();
    });
  }

  async function load() {
    lang = pickLanguage();
    const get = (code) => fetch(`assets/i18n/${code}.json?v=${ASSET_VERSION}`).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
    fallback = await get(DEFAULT);
    dict = lang === DEFAULT ? fallback : await get(lang);
    document.documentElement.lang = lang;
    if (window.VT && typeof window.VT.setLocale === "function") {
      window.VT.setLocale(locale(), {
        dayUnit: t("time.dayUnit"), expired: t("time.expired"),
        tzNames: { "America/Los_Angeles": t("tz.pacific"), "America/New_York": t("tz.eastern"), "Pacific/Honolulu": t("tz.hawaii") },
      });
    }
    applyStatic();
    initSelector();
  }

  window.I18N = { LANGUAGES, ASSET_VERSION, load, t, applyStatic, locale, get lang() { return lang; } };
})();
