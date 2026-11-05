/* Страница «Для продвинутых»: настройки расчёта, факты для LLM, качество данных, JSON.
   Слева — ручки (рисуются один раз), справа — отчёт (перерисовывается при каждой правке). */
(function () {
  "use strict";
  const { esc, pct, fmt, dec } = Lab;
  const $ = (id) => document.getElementById(id);
  let jsonTab = "facts";

  function railHtml() {
    const s = Lab.settings, C = Lab.CFG;
    return `<aside class="card rail" aria-label="Настройки расчёта">
      <div><h3>Настройки расчёта</h3><p class="small muted" style="margin-top:4px">Меняют цифры на обеих страницах.</p></div>
      <div class="ctl">
        <div class="ctl-head"><label for="threshold">Порог засчитывания</label><span class="val" id="thresholdVal">${s.thresholdSec} с</span></div>
        <input id="threshold" type="range" min="${C.sliders.thresholdSec.min}" max="${C.sliders.thresholdSec.max}" step="${C.sliders.thresholdSec.step}" value="${s.thresholdSec}">
        <div class="hint">С какой длительности прослушивание считается. У Spotify — 30 с.</div>
      </div>
      <div class="ctl">
        <div class="ctl-head"><label for="recent">Окно «сейчас»</label><span class="val" id="recentVal">${s.recentDays} дн.</span></div>
        <input id="recent" type="range" min="${C.sliders.recentDays.min}" max="${C.sliders.recentDays.max}" step="${C.sliders.recentDays.step}" value="${s.recentDays}">
        <div class="hint">Отсчитывается от последнего прослушивания в архиве, а не от сегодняшнего дня.</div>
      </div>
      <div class="ctl"><label for="tz">Часовой пояс</label>
        <select id="tz">${[...new Set([...C.timezones, s.tz])].map((z) => `<option ${z === s.tz ? "selected" : ""}>${esc(z)}</option>`).join("")}</select></div>
      <div class="ctl"><label for="topn">Размер топов</label>
        <select id="topn">${C.topNChoices.map((n) => `<option ${n === s.topN ? "selected" : ""}>${n}</option>`).join("")}</select></div>
      <div class="ctl"><label for="aliases">Псевдонимы артистов</label>
        <textarea id="aliases" spellcheck="false">${esc(s.aliasesText)}</textarea>
        <div class="hint" id="aliasHint">JSON: каноническое имя → список псевдонимов. Регистр не важен.</div></div>
      <button class="btn small-btn" id="resetBtn" type="button">Вернуть по умолчанию</button>
    </aside>`;
  }

  function bindRail() {
    $("threshold").addEventListener("input", (e) => { $("thresholdVal").textContent = e.target.value + " с"; Lab.updateSetting({ thresholdSec: +e.target.value }); });
    $("recent").addEventListener("input", (e) => { $("recentVal").textContent = e.target.value + " дн."; Lab.updateSetting({ recentDays: +e.target.value }); });
    $("tz").addEventListener("change", (e) => Lab.updateSetting({ tz: e.target.value }));
    $("topn").addEventListener("change", (e) => Lab.updateSetting({ topN: +e.target.value }));
    let timer;
    $("aliases").addEventListener("input", (e) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const hint = $("aliasHint");
        try {
          Lab.setAliasesText(e.target.value);
          e.target.classList.remove("bad"); hint.style.color = "";
          hint.textContent = "JSON: каноническое имя → список псевдонимов. Регистр не важен.";
        } catch (err) {
          e.target.classList.add("bad"); hint.style.color = "var(--down)";
          hint.textContent = "Не применено: " + err.message + ". Считаю с прошлым рабочим списком.";
        }
      }, 350);
    });
    $("resetBtn").addEventListener("click", () => Lab.resetSettings());
  }

  function tile(label, value, prevValue, f, hint) {
    let was = hint ? esc(hint) : "";
    if (prevValue != null && prevValue !== value) {
      const up = value > prevValue;
      was = `<span class="${up ? "up" : "down"}">${up ? "▲" : "▼"}</span> было ${esc(f(prevValue))}`;
    }
    return `<div class="tile"><div class="label">${esc(label)}</div><div class="big">${esc(f(value))}</div><div class="was">${was}</div></div>`;
  }

  function report(p, old) {
    const h = p.history, oh = old && old.history, out = [];
    const st = Lab.state;
    out.push(`<div class="chips">
      <span class="chip ${st.isDemo ? "demo" : ""}">${st.isDemo ? "Демо: вымышленные артисты" : "Источник: " + esc(st.sourceLabel)}</span>
      <span class="chip">История: ${p.history_kind === "extended" ? "расширенная" : p.history_kind === "basic" ? "упрощённая" : "нет"}</span>
      <span class="chip">${esc(p.timezone)}</span>
      ${h ? `<span class="chip">${esc(h.period.first_play.slice(0, 10))} — ${esc(h.period.last_play.slice(0, 10))}</span>` : ""}</div>`);

    if (h) out.push(`<div class="tiles">
      ${tile("Засчитано прослушиваний", h.totals.counted_plays, oh && oh.totals.counted_plays, fmt, `из ${fmt(h.totals.records)} записей`)}
      ${tile("Часов музыки", h.totals.listening_hours, oh && oh.totals.listening_hours, dec, `${fmt(h.period.active_days)} активных дней`)}
      ${tile("Артистов", h.totals.unique_artists, oh && oh.totals.unique_artists, fmt, `${fmt(h.totals.unique_tracks)} треков`)}
      ${tile("Эффективно артистов", h.concentration.effective_artists, oh && oh.concentration.effective_artists, dec, "exp(энтропии)")}
      ${tile("Доля лидера", h.concentration.top1_share, oh && oh.concentration.top1_share, (v) => pct(v, 1), h.top_artists[0] ? h.top_artists[0].name : "")}
    </div>`);

    // факты
    const oldIds = new Map((old ? old.facts : []).map((f) => [f.id, f.text]));
    const gone = old ? old.facts.filter((f) => !p.facts.some((x) => x.id === f.id)) : [];
    out.push(`<section class="card">
      <div class="card-head"><div><h2>Факты для карточки</h2>
        <p>Именно это LLM получит как проверенные утверждения. Неверный или скучный факт исправляй в расчётах, а не в промпте.</p></div>
        <span class="muted small num">${p.facts.length} фактов</span></div>
      <ul class="facts">${p.facts.map((f) => {
        const tag = old && !oldIds.has(f.id) ? '<span class="tag">новый</span>' : old && oldIds.get(f.id) !== f.text ? '<span class="tag">изменился</span>' : "";
        return `<li><code>${esc(f.id)}</code><div>${esc(f.text)}${tag}</div></li>`;
      }).join("")}${gone.map((f) => `<li><code>${esc(f.id)}</code><div class="muted"><s>${esc(f.text)}</s><span class="tag gone">пропал</span></div></li>`).join("")}</ul>
    </section>`);

    if (h) {
      const r = h.recent_vs_all_time;
      out.push(`<section class="card">
        <div class="card-head"><div><h2>Смена вкуса: все цифры</h2><p>Окно ${r.recent_days} дн., в нём ${fmt(r.recent_counted_plays)} засчитанных прослушиваний. Минимум для факта — ${Lab.CFG.rules.minRecentPlays}.</p></div></div>
        ${r.reliable ? "" : `<div class="note" style="margin-bottom:12px">Прослушиваний в окне меньше ${Lab.CFG.rules.minRecentPlays}, поэтому факт о смене вкуса не делается.</div>`}
        <div class="tbl-wrap"><table><thead><tr><th>Артист</th><th>Сейчас</th><th>Всё время</th><th>Разница, п.п.</th><th>Прослушиваний</th></tr></thead><tbody>
        ${r.top_recent.map((x) => `<tr><td>${esc(x.name)}</td><td class="n">${pct(x.share_recent, 1)}</td><td class="n">${pct(x.share_all_time, 1)}</td>
          <td class="n ${x.delta > 0 ? "up" : x.delta < 0 ? "down" : ""}">${x.delta > 0 ? "+" : ""}${dec((x.delta * 100).toFixed(1))}</td><td class="n">${fmt(x.plays)}</td></tr>`).join("")}
        </tbody></table></div>
      </section>`);

      const s = h.skips;
      out.push(`<section class="card">
        <div class="card-head"><div><h2>Пропуски</h2><p>Доля записей, где трек пропустили кнопкой «дальше». В рейтинге — артисты с ${Lab.CFG.rules.minSkipRecords}+ записями.</p></div></div>
        ${s.available ? `<div class="skipgrid">
          <div><div class="label-sm">Всего</div><div class="big-num">${pct(s.skip_rate)}</div></div>
          <div><div class="label-sm">Чаще пропускают</div>${s.most_skipped_artists.map((a) => `<div class="num">${esc(a.name)} — ${pct(a.skip_rate)}</div>`).join("") || '<div class="muted">мало данных</div>'}</div>
          <div><div class="label-sm">Реже пропускают</div>${s.least_skipped_artists.map((a) => `<div class="num">${esc(a.name)} — ${pct(a.skip_rate)}</div>`).join("") || '<div class="muted">мало данных</div>'}</div>
        </div>` : `<div class="muted">Нет данных: ${esc(s.reason)}. Появятся с расширенной историей.</div>`}
      </section>`);
    }

    out.push(`<section class="card">
      <div class="card-head"><div><h2>Плейлисты</h2><p>Локальные файлы и подкасты в плейлистах не читаются.</p></div><span class="muted small num">${p.playlists.length} шт.</span></div>
      ${p.playlists.length ? `<div class="tbl-wrap"><table><thead><tr><th>Плейлист</th><th>Треков</th><th>Артистов</th><th>Лидер</th><th>Добавлялись</th></tr></thead><tbody>
        ${p.playlists.map((pl) => `<tr><td>${esc(pl.name)}${pl.unreadable_items ? `<div class="muted small">+${pl.unreadable_items} не прочитано</div>` : ""}</td>
          <td class="n">${pl.track_count}</td><td class="n">${pl.unique_artists}</td>
          <td>${pl.top_artists[0] ? `${esc(pl.top_artists[0].name)} <span class="muted num">${pct(pl.top_artists[0].share)}</span>` : "—"}</td>
          <td class="n">${pl.added_from ? esc(pl.added_from) + " — " + esc(pl.added_to) : "—"}</td></tr>`).join("")}
      </tbody></table></div>` : '<div class="muted">В архиве нет плейлистов.</div>'}
    </section>`);

    const covNames = { track_title: "названия", artist: "артисты", album: "альбомы", skips: "пропуски", genres: "жанры", release_year: "годы выпуска", audio_features: "аудиопризнаки", lyrics: "тексты" };
    out.push(`<div class="grid-2">
      <section class="card"><div class="card-head"><div><h2>Качество данных</h2><p>Зачёркнутого в данных нет, и LLM не должна об этом говорить.</p></div></div>
        <div class="chips" style="margin-bottom:16px">${Object.entries(p.metadata_coverage).map(([k, v]) => `<span class="chip ${v ? "" : "off"}">${covNames[k] || k}</span>`).join("")}</div>
        <dl class="kv">
          <dt>Порог</dt><dd class="num">${p.play_threshold_seconds} с${h ? ` · отброшено коротких: ${fmt(h.totals.short_plays_under_threshold)}` : ""}</dd>
          <dt>Подкасты</dt><dd class="num">${fmt(p.podcast_plays_excluded)} исключено</dd>
          <dt>Аудиокниги</dt><dd class="num">${fmt(p.audiobook_plays_excluded)} исключено</dd>
          <dt>Библиотека</dt><dd class="num">${fmt(p.library_track_count)} лайков</dd>
          <dt>Склейки</dt><dd>${Object.keys(p.aliases_merged).length ? Object.entries(p.aliases_merged).map(([c, rs]) => `${esc(c)} ← ${esc(rs.join(", "))}`).join("<br>") : '<span class="muted">не сработала ни одна</span>'}</dd>
        </dl>
        ${p.warnings.length ? `<ul class="warn-list">${p.warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>` : ""}
      </section>
      <section class="card"><div class="card-head"><div><h2>Вход для LLM</h2><p>Тот же формат, что выдаёт Python-скрипт.</p></div>
        <div class="btn-row"><div class="tabs" role="tablist">
          <button role="tab" type="button" data-tab="facts" aria-selected="${jsonTab === "facts"}">Факты</button>
          <button role="tab" type="button" data-tab="full" aria-selected="${jsonTab === "full"}">Весь профиль</button></div>
          <button class="btn small-btn" type="button" id="copyBtn">Копировать</button></div></div>
        <pre class="json" id="jsonOut" tabindex="0"></pre>
        <div class="status" id="copyStatus"></div>
      </section>
    </div>`);
    out.push(spotifyCard(p));
    out.push(filesCard(p.files));
    return out.join("");
  }

  const RAW_LABELS = {
    explicit_share: ["Треки с пометкой E", (v) => pct(v)],
    angry_tracks_share: ["«Злые» треки", (v) => pct(v)],
    party_tracks_share: ["«Тусовочные» треки", (v) => pct(v)],
    kids_tracks_share: ["«Детские» треки", (v) => pct(v)],
    avg_tempo_bpm: ["Средний темп, BPM", dec],
    avg_popularity: ["Средняя популярность треков (0–1)", dec],
    multilinguist_score: ["Оценка «многоязычности»", dec],
    chaos_score: ["Оценка «хаоса»", dec],
    top_artist_fan_percentile: ["Процентиль фаната артиста №1 (как в файле)", (v) => String(v)],
    club: ["Клуб", String],
    club_role: ["Роль в клубе", String],
  };
  function spotifyCard(p) {
    const m = p.marquee, w = p.wrapped, c = p.sound_capsule;
    if (!m.available && !w.available && !c.available) return "";
    const parts = [];
    if (m.available) parts.push(`<div><h3>Уровни фанатства (Marquee)</h3>
      <div class="tbl-wrap"><table><thead><tr><th>Группа</th><th>Артистов</th></tr></thead><tbody>
      ${[["super", "Super Listeners"], ["moderate", "Moderate listeners"], ["light", "Light listeners"], ["previous", "Previously Active Listeners"], ["other", "Другие группы"]]
        .filter(([k]) => m.counts[k] || k !== "other").map(([k, l]) => `<tr><td>${l}</td><td class="n">${fmt(m.counts[k])}</td></tr>`).join("")}
      </tbody></table></div>
      <p class="small muted" style="margin-top:8px">Из «Previously Active» в плейлистах: ${fmt(m.previous_in_playlists_count)}. Псевдонимы склеиваются, у склеенного артиста остаётся самая сильная группа.</p></div>`);
    if (w.available) parts.push(`<div><h3>Итоги ${esc(w.year)}: цифры без объяснений от Spotify</h3>
      <p class="small muted" style="margin-bottom:8px">Spotify не пишет, как он их считает, поэтому в «Обзор» они не попадают и в факты для LLM тоже.</p>
      <div class="tbl-wrap"><table><tbody>
      ${Object.entries(w.spotify_raw).filter(([, v]) => v !== null && v !== undefined)
        .map(([k, v]) => `<tr><td>${esc((RAW_LABELS[k] || [k])[0])}</td><td class="n">${esc((RAW_LABELS[k] || [k, String])[1](v))}</td></tr>`).join("")}
      ${w.top_artist_fan_rank !== null ? `<tr><td>Место среди фанатов артиста №1</td><td class="n">${fmt(w.top_artist_fan_rank)}</td></tr>` : ""}
      ${w.unique_genres !== null ? `<tr><td>Разных жанров</td><td class="n">${fmt(w.unique_genres)}</td></tr>` : ""}
      ${w.completed_albums !== null ? `<tr><td>Альбомов дослушано целиком</td><td class="n">${fmt(w.completed_albums)}</td></tr>` : ""}
      </tbody></table></div></div>`);
    if (c.available) parts.push(`<div style="grid-column:1 / -1"><h3>Капсула: недели</h3>
      <p class="small muted" style="margin-bottom:8px">Число прослушиваний за неделю Spotify в файле не заполняет (там 0), поэтому берём время.</p>
      <div class="tbl-wrap"><table><thead><tr><th>Неделя</th><th>Часов</th><th>Топ-5 артистов</th><th>Трек недели</th></tr></thead><tbody>
      ${c.weeks.map((x) => `<tr><td class="n">${esc(x.week)}</td><td class="n">${dec(x.hours.toFixed(1))}</td><td>${esc(x.top_artists.join(", "))}</td>
        <td>${x.top_track ? `${esc(x.top_track)} <span class="muted num">${fmt(x.top_track_plays)}</span>` : "—"}</td></tr>`).join("")}
      </tbody></table></div></div>`);
    return `<section class="card"><div class="card-head"><div><h2>Данные самого Spotify</h2>
      <p>Выводы, которые Spotify сделал сам: Marquee, итоги года и недельная капсула.</p></div></div>
      <div class="grid-2">${parts.join("")}</div></section>`;
  }

  const FILE_GROUPS = [
    ["used", "Используем", "Из этих файлов считается вся статистика."],
    ["planned", "Пригодятся, добавим позже", "Здесь есть музыкальные данные, которых нет в истории."],
    ["personal_not_read", "Личные данные: не открываем", "Адрес, платежи, переписка, поиск. Панель их даже не распаковывает."],
    ["service", "Служебные и пустые", "Инструкция Spotify и пустые разделы."],
    ["unknown", "Неизвестные", "Таких файлов мы ещё не встречали. Если они есть — напиши, разберём."],
  ];
  function filesCard(files) {
    const groups = FILE_GROUPS.filter(([k]) => (files[k] || []).length);
    return `<section class="card"><div class="card-head"><div><h2>Файлы архива</h2>
      <p>Что лежит в архиве и что панель с этим делает.</p></div></div>
      <div class="file-groups">${groups.map(([k, title, hint]) => `<div class="file-group fg-${k}">
        <h3>${title} <span class="muted num">${files[k].length}</span></h3><p class="small muted">${hint}</p>
        <ul>${files[k].map((f) => `<li><code>${esc(f.name)}</code>${f.about ? `<span>${esc(f.about)}</span>` : ""}</li>`).join("")}</ul></div>`).join("")}
      </div></section>`;
  }

  function bindReport(p) {
    const data = jsonTab === "facts" ? { facts: p.facts, metadata_coverage: p.metadata_coverage, limitations: p.limitations } : p;
    $("jsonOut").textContent = JSON.stringify(data, null, 2);
    document.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => { jsonTab = b.dataset.tab; Lab.views.advanced.render(null, false); }));
    $("copyBtn").addEventListener("click", () => {
      const text = $("jsonOut").textContent;
      const done = (ok) => { $("copyStatus").textContent = ok ? "Скопировано." : "Не удалось скопировать: текст выделен, нажми Cmd+C."; };
      const selectAll = () => { const r = document.createRange(); r.selectNodeContents($("jsonOut")); const s = getSelection(); s.removeAllRanges(); s.addRange(r); };
      try { navigator.clipboard.writeText(text).then(() => done(true), () => { selectAll(); done(false); }); }
      catch (e) { selectAll(); done(false); }
    });
  }

  Lab.views.advanced = {
    render(el, full) {
      const p = Lab.state.profile;
      if (full || !$("advReport")) {
        (el || $("view")).innerHTML = `<div class="adv">${railHtml()}<div class="report" id="advReport"></div></div>`;
        bindRail();
      }
      $("advReport").innerHTML = report(p, full ? null : Lab.state.prevProfile);
      bindReport(p);
    },
  };
})();
