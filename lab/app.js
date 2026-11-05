/* Общая часть: загрузка архива, настройки, переключение страниц, подсказки.
   Сами страницы — в view-simple.js и view-advanced.js. */
(function () {
  "use strict";
  const CFG = window.LAB_CONFIG;
  const KEY = "profile-lab-settings-v1";
  const $ = (id) => document.getElementById(id);

  // ---------- форматирование (используют обе страницы) ----------
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pct = (x, d = 0) => `${(x * 100).toFixed(d).replace(".", ",")}%`;
  const fmt = (x) => Number(x).toLocaleString("ru-RU");
  const dec = (x) => String(x).replace(".", ",");
  const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
  const MONTHS_SHORT = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
  const dateRu = (iso) => { const [y, m, d] = iso.slice(0, 10).split("-"); return `${+d} ${MONTHS[+m - 1]} ${y}`; };
  const monthRu = (ym) => { const [y, m] = ym.split("-"); return `${MONTHS_SHORT[+m - 1]} ${y}`; };
  // 1 артист, 2 артиста, 5 артистов
  const plural = (n, one, few, many) => {
    const a = Math.abs(n) % 100, b = a % 10;
    return a > 10 && a < 20 ? many : b === 1 ? one : b >= 2 && b <= 4 ? few : many;
  };

  // ---------- настройки ----------
  const DEFAULTS = {
    thresholdSec: CFG.defaults.thresholdSec, recentDays: CFG.defaults.recentDays,
    tz: CFG.defaults.tz, topN: CFG.defaults.topN,
    aliasesText: JSON.stringify(CFG.defaults.aliases || {}, null, 2),
  };
  let settings = Object.assign({}, DEFAULTS);
  try { const s = JSON.parse(localStorage.getItem(KEY) || "null"); if (s) settings = Object.assign(settings, s); } catch (e) {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch (e) {} };

  function parseAliases(text) {
    const o = text.trim() ? JSON.parse(text) : {};
    if (typeof o !== "object" || Array.isArray(o) || o === null) throw new Error("нужен объект {…}");
    for (const [k, v] of Object.entries(o)) if (!Array.isArray(v)) throw new Error(`у «${k}» значение должно быть списком […]`);
    return o;
  }
  let aliasesObj = {};
  try { aliasesObj = parseAliases(settings.aliasesText); } catch (e) { aliasesObj = CFG.defaults.aliases || {}; }

  // ---------- состояние ----------
  const state = { raw: null, sourceLabel: "", isDemo: false, profile: null, prevProfile: null, route: "overview" };

  function compute() {
    if (!state.raw) return;
    state.prevProfile = state.profile;
    state.profile = ProfileCore.buildProfile(state.raw, {
      tz: settings.tz, recentDays: settings.recentDays, topN: settings.topN, thresholdSec: settings.thresholdSec,
      aliases: aliasesObj, minRecentPlays: CFG.rules.minRecentPlays, minSkipRecords: CFG.rules.minSkipRecords,
    });
  }

  // ---------- страницы ----------
  const views = {};
  function route() {
    const r = location.hash === "#advanced" ? "advanced" : "overview";
    const changed = r !== state.route;
    state.route = r;
    document.querySelectorAll("[data-route]").forEach((a) =>
      a.setAttribute("aria-current", a.dataset.route === r ? "page" : "false"));
    document.title = r === "advanced" ? "Для продвинутых — Лаборатория профиля" : "Лаборатория профиля";
    render(true);
    if (changed) window.scrollTo(0, 0);
  }
  function render(full) {
    const v = views[state.route];
    if (!v) return;
    if (!state.profile) { $("view").innerHTML = `<div class="empty">Загрузи архив Spotify кнопкой «Загрузить архив» или посмотри «Демо».</div>`; return; }
    v.render($("view"), full);
  }

  // ---------- загрузка ----------
  const setStatus = (t, err) => { $("status").textContent = t; $("status").className = "status" + (err ? " err" : ""); };

  async function loadZipBuffer(buf, label, demo) {
    if (typeof JSZip === "undefined") { setStatus("Не найдена библиотека чтения ZIP (vendor/jszip.min.js).", true); return; }
    setStatus("Читаю архив…");
    try { useFiles(await ProfileCore.readZip(JSZip, buf), label, demo); }
    catch (e) { setStatus("Это не похоже на ZIP-архив. Нужен файл, который прислал Spotify, например my_spotify_data.zip.", true); }
  }
  function useFiles(files, label, demo) {
    const parsed = ProfileCore.parseFiles(files);
    if (!parsed.plays.length && !parsed.playlists.length) {
      setStatus("В этих файлах нет ни истории прослушиваний, ни плейлистов. Нужен архив из раздела «Конфиденциальность» в аккаунте Spotify.", true);
      return;
    }
    Object.assign(state, { raw: parsed, sourceLabel: label, isDemo: demo, profile: null, prevProfile: null });
    compute();
    setStatus(demo ? "" : `Загружено: ${label}.`);
    render(true);
  }
  async function handleFiles(list) {
    const files = [...list];
    if (!files.length) return;
    const zip = files.find((f) => /\.zip$/i.test(f.name));
    if (zip) return loadZipBuffer(await zip.arrayBuffer(), zip.name, false);
    setStatus("Читаю файлы…");
    const out = [];
    for (const f of files) {
      const pc = ProfileCore.preclassify(f.name);   // личные файлы не открываем даже по одному
      if (pc && pc.skip) continue;
      if (pc) { out.push({ name: f.name, pre: pc.pre }); continue; }
      try { out.push({ name: f.name, obj: JSON.parse((await f.text()).replace(/^﻿/, "")), err: null }); }
      catch (e) { out.push({ name: f.name, obj: null, err: "bad json: " + e.message }); }
    }
    useFiles(out, files.length === 1 ? files[0].name : `${files.length} JSON-файлов`, false);
  }
  function loadDemo() {
    if (!window.DEMO_ZIP_B64) { setStatus("Рядом со страницей нет файла demo-data.js.", true); return; }
    const bin = atob(window.DEMO_ZIP_B64), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    loadZipBuffer(bytes, "demo_export.zip", true);
  }

  // ---------- подсказки при наведении ----------
  function setupTips() {
    const tip = $("tip");
    const show = (el, x, y) => {
      tip.textContent = el.dataset.tip; tip.hidden = false;
      const w = tip.offsetWidth, h = tip.offsetHeight;
      tip.style.left = Math.max(8, Math.min(innerWidth - w - 8, x - w / 2)) + "px";
      tip.style.top = Math.max(8, y - h - 12) + "px";
    };
    document.addEventListener("mousemove", (e) => {
      const el = e.target.closest && e.target.closest("[data-tip]");
      if (el) show(el, e.clientX, e.clientY); else tip.hidden = true;
    });
    document.addEventListener("focusin", (e) => {
      const el = e.target.closest && e.target.closest("[data-tip]");
      if (el) { const r = el.getBoundingClientRect(); show(el, r.left + r.width / 2, r.top); } else tip.hidden = true;
    });
    document.addEventListener("scroll", () => { tip.hidden = true; }, { passive: true });
  }

  function start() {
    $("file").addEventListener("change", (e) => { handleFiles(e.target.files); e.target.value = ""; });
    $("demoBtn").addEventListener("click", loadDemo);
    let depth = 0;
    document.addEventListener("dragenter", (e) => { e.preventDefault(); depth++; $("dragHint").hidden = false; });
    document.addEventListener("dragover", (e) => e.preventDefault());
    document.addEventListener("dragleave", () => { if (--depth <= 0) { depth = 0; $("dragHint").hidden = true; } });
    document.addEventListener("drop", (e) => { e.preventDefault(); depth = 0; $("dragHint").hidden = true; handleFiles(e.dataTransfer.files); });
    window.addEventListener("hashchange", route);
    setupTips();
    state.route = null;
    route();
    if (CFG.autoloadDemo) loadDemo();
  }

  window.Lab = {
    CFG, state, views, start, esc, pct, fmt, dec, dateRu, monthRu, plural,
    get settings() { return settings; },
    DEFAULTS,
    // вызывается страницей «Для продвинутых», когда меняют настройку
    updateSetting(patch) {
      Object.assign(settings, patch); save(); compute(); render(false);
    },
    setAliasesText(text) {
      settings.aliasesText = text;
      aliasesObj = parseAliases(text); // бросит ошибку, если JSON неверный
      save(); compute(); render(false);
    },
    resetSettings() {
      settings = Object.assign({}, DEFAULTS);
      aliasesObj = CFG.defaults.aliases || {};
      save(); compute(); render(true);
    },
  };
})();
