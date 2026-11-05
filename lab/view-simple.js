/* Страница «Обзор» — для обычного пользователя.
   Правило: только понятные цифры и обычные слова. Ничего про пороги, JSON и LLM. */
(function () {
  "use strict";
  const { esc, pct, fmt, dec, dateRu, monthRu, plural } = Lab;

  function hero(p) {
    const h = p.history, top = h.top_artists[0];
    const days = h.period.active_days;
    return `<section class="hero">
      <div>
        <div class="eyebrow">${esc(dateRu(h.period.first_play))} — ${esc(dateRu(h.period.last_play))}</div>
        <h1>${top ? `Твой артист №1 — ${esc(top.name)}` : "Твоя музыка"}</h1>
        <p class="lead">${top ? `Это ${pct(top.share)} всех твоих прослушиваний: ${fmt(top.plays)} ${plural(top.plays, "прослушивание", "прослушивания", "прослушиваний")} и ${dec(top.hours)} ч.` : ""}</p>
      </div>
      <div class="stats">
        <div class="stat"><b>${dec(Math.round(h.totals.listening_hours))}</b><span>${plural(Math.round(h.totals.listening_hours), "час", "часа", "часов")} музыки</span></div>
        <div class="stat"><b>${fmt(h.totals.counted_plays)}</b><span>${plural(h.totals.counted_plays, "прослушивание", "прослушивания", "прослушиваний")}</span></div>
        <div class="stat"><b>${fmt(h.totals.unique_artists)}</b><span>${plural(h.totals.unique_artists, "артист", "артиста", "артистов")}</span></div>
        <div class="stat"><b>${fmt(days)}</b><span>${plural(days, "день", "дня", "дней")} с музыкой</span></div>
      </div>
    </section>`;
  }

  function topArtists(h, merged) {
    const max = Math.max(...h.top_artists.map((a) => a.share), 0.0001);
    return `<section class="card">
      <div class="card-head"><div><h2>Любимые артисты</h2><p>Доля от всех твоих прослушиваний.</p></div></div>
      <div class="rows">${h.top_artists.map((a, i) => `
        <div class="row" tabindex="0" data-tip="${esc(`${a.name}: ${fmt(a.plays)} прослушиваний, ${dec(a.hours)} ч`)}">
          <div class="rank">${i + 1}</div>
          <div class="title"><b>${esc(a.name)}</b><span>${fmt(a.plays)} ${plural(a.plays, "раз", "раза", "раз")}${merged[a.name] ? ` · вместе с ${esc(merged[a.name].join(", "))}` : ""}</span></div>
          <div class="bar"><i style="width:${(a.share / max * 100).toFixed(2)}%"></i></div>
          <div class="val">${pct(a.share)}</div>
        </div>`).join("")}</div>
    </section>`;
  }

  function topTracks(h) {
    return `<section class="card">
      <div class="card-head"><div><h2>Любимые треки</h2><p>Сколько раз трек играл дольше ${Lab.settings.thresholdSec} секунд.</p></div></div>
      <div class="rows tracks">${h.top_tracks.map((t, i) => `
        <div class="row" tabindex="0">
          <div class="rank">${i + 1}</div>
          <div class="title"><b>${esc(t.track)}</b><span>${esc(t.artist)}</span></div>
          <div class="val">${fmt(t.plays)}</div>
        </div>`).join("")}</div>
    </section>`;
  }

  function now(h) {
    const r = h.recent_vs_all_time, top = h.top_artists[0];
    const list = r.top_recent.slice(0, 5);
    if (!list.length) return "";
    const lead = list[0];
    let say;
    if (!r.reliable) say = `За последние ${r.recent_days} дней прослушиваний мало, поэтому сравнивать пока рано.`;
    else if (top && lead.name !== top.name)
      say = `Сейчас на первом месте <b>${esc(lead.name)}</b>: ${pct(lead.share_recent)} прослушиваний за последние ${r.recent_days} дней. За всё время у этого артиста было ${pct(lead.share_all_time)}.`;
    else say = `Вкус не меняется: и сейчас, и за всё время чаще всего играет <b>${esc(lead.name)}</b>.`;
    const max = Math.max(...list.flatMap((x) => [x.share_recent, x.share_all_time]), 0.0001);
    return `<section class="card">
      <div class="card-head"><div><h2>Что ты слушаешь сейчас</h2><p>Последние ${r.recent_days} дней в сравнении со всем временем.</p></div>
        <div class="legend"><span><i style="background:var(--chart)"></i>сейчас</span><span><i style="background:var(--chart-2)"></i>за всё время</span></div></div>
      <p class="say" style="margin-bottom:18px">${say}</p>
      <div class="pairs">${list.map((x) => {
        const pp = Math.round(x.delta * 100);
        const cls = pp > 0 ? "up" : pp < 0 ? "down" : "";
        const label = pp > 0 ? `▲ +${pp}%` : pp < 0 ? `▼ ${pp}%` : "без изменений";
        return `<div class="pair" tabindex="0" data-tip="${esc(`${x.name}: сейчас ${pct(x.share_recent)}, за всё время ${pct(x.share_all_time)}`)}">
          <div class="name">${esc(x.name)}</div>
          <div><div class="bars"><div class="b now" style="width:${(x.share_recent / max * 100).toFixed(2)}%"></div>
            <div class="b all" style="width:${(x.share_all_time / max * 100).toFixed(2)}%"></div></div>
            <div class="vals">${pct(x.share_recent)} сейчас · ${pct(x.share_all_time)} за всё время</div></div>
          <div class="d ${cls}">${label}</div></div>`;
      }).join("")}</div>
    </section>`;
  }

  function when(p) {
    const t = p.history.time_habits;
    const parts = ["утро", "день", "вечер", "ночь"];
    const best = parts.reduce((a, b) => (t.part_of_day_share[b] > t.part_of_day_share[a] ? b : a));
    const ranges = { утро: "с 6 до 12", день: "с 12 до 18", вечер: "с 18 до полуночи", ночь: "с полуночи до 6" };
    const word = { утро: "утром", день: "днём", вечер: "вечером", ночь: "ночью" }[best];
    const maxH = Math.max(...t.hour_distribution, 0.0001);
    const wd = Object.entries(t.weekday_share), maxW = Math.max(...wd.map((x) => x[1]), 0.0001);
    const bestDay = wd.reduce((a, b) => (b[1] > a[1] ? b : a))[0];
    const dayFull = { пн: "понедельник", вт: "вторник", ср: "среду", чт: "четверг", пт: "пятницу", сб: "субботу", вс: "воскресенье" };
    const hh = (h) => String(h).padStart(2, "0");
    return `<section class="card">
      <div class="card-head"><div><h2>Когда ты слушаешь</h2></div></div>
      <p class="say">Больше всего музыки ${word} (${ranges[best]}) — ${pct(t.part_of_day_share[best])}. Самый музыкальный час — ${hh(t.peak_hour)}:00.</p>
      <p class="say" style="margin-bottom:18px">Чаще всего музыка играет в ${dayFull[bestDay]}.</p>
      <div class="split">
        <div><div class="cols">${t.hour_distribution.map((v, i) => `<div class="c ${i === t.peak_hour ? "hi" : ""}" tabindex="0" style="height:${(v / maxH * 100).toFixed(2)}%" data-tip="${hh(i)}:00–${hh((i + 1) % 24)}:00 · ${pct(v, 1)}"></div>`).join("")}</div>
          <div class="axis"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>23:00</span></div></div>
        <div><div class="cols">${wd.map(([d, v]) => `<div class="c ${d === bestDay ? "hi" : ""}" tabindex="0" style="height:${(v / maxW * 100).toFixed(2)}%" data-tip="${dayFull[d]}: ${pct(v, 1)}"></div>`).join("")}</div>
          <div class="axis">${wd.map(([d]) => `<span>${d}</span>`).join("")}</div></div>
      </div>
      <div class="parts">${parts.map((k) => `<div class="${k === best ? "hi" : ""}"><b>${pct(t.part_of_day_share[k])}</b><span>${k}</span></div>`).join("")}</div>
    </section>`;
  }

  function months(h) {
    const m = h.by_month;
    if (m.length < 2) return "";
    const max = Math.max(...m.map((x) => x.plays), 1);
    const peak = m.reduce((a, b) => (b.plays > a.plays ? b : a));
    const ticks = m.filter((x, i) => i === 0 || x.month.endsWith("-01") || i === m.length - 1);
    return `<section class="card">
      <div class="card-head"><div><h2>Музыка по месяцам</h2><p>Наведи на столбик, чтобы увидеть лидера месяца.</p></div></div>
      <p class="say" style="margin-bottom:18px">Самый музыкальный месяц — ${esc(monthRu(peak.month))}: ${fmt(peak.plays)} прослушиваний.</p>
      <div class="cols" style="height:150px">${m.map((x) => `<div class="c ${x === peak ? "hi" : ""}" tabindex="0" style="height:${(x.plays / max * 100).toFixed(2)}%"
        data-tip="${esc(`${monthRu(x.month)}: ${fmt(x.plays)} прослушиваний, чаще всего ${x.top_artist}`)}"></div>`).join("")}</div>
      <div class="axis">${ticks.map((x) => `<span>${esc(monthRu(x.month))}</span>`).join("")}</div>
    </section>`;
  }

  function playlistsOnly(p) {
    // если истории нет, но есть плейлисты — показываем хотя бы их
    return `<section class="card"><div class="card-head"><div><h2>Твои плейлисты</h2>
      <p>Истории прослушиваний в этих файлах нет — она придёт в архиве позже.</p></div></div>
      <div class="rows tracks">${p.playlists.map((pl, i) => `<div class="row"><div class="rank">${i + 1}</div>
        <div class="title"><b>${esc(pl.name)}</b><span>${pl.top_artists[0] ? "чаще всего " + esc(pl.top_artists[0].name) : ""}</span></div>
        <div class="val">${pl.track_count}</div></div>`).join("")}</div></section>`;
  }


  // ---------- данные самого Spotify: Marquee, капсула, итоги года ----------
  const MON_SHORT = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
  const dayMon = (iso) => { if (!iso) return ""; const [, m, d] = iso.split("-"); return `${+d} ${MON_SHORT[+m - 1]}`; };

  function fans(p) {
    const m = p.marquee;
    if (!m || !m.available) return "";
    const levels = [
      ["super", "Самый преданный слушатель", "Super Listeners"],
      ["moderate", "Частый слушатель", "Moderate listeners"],
      ["light", "Иногда слушаешь", "Light listeners"],
      ["previous", "Слушал(а) раньше", "Previously Active"],
    ];
    const chip = (x, tipText) => `<span class="chip fan-chip" tabindex="0" data-tip="${esc(tipText)}">${esc(x.name)}</span>`;
    const supers = m.super.map((x) => chip(x, x.plays_in_history ? `${x.name}: ${fmt(x.plays_in_history)} прослушиваний за год` : x.name)).join("");
    const past = m.previous_in_playlists.map((x) => chip(x, `${x.name}: ${fmt(x.playlist_tracks)} ${plural(x.playlist_tracks, "трек", "трека", "треков")} в твоих плейлистах`)).join("");
    const lead = m.counts.super
      ? `Spotify считает тебя одним из самых преданных слушателей у ${fmt(m.counts.super)} ${m.counts.super % 10 === 1 && m.counts.super % 100 !== 11 ? "артиста" : "артистов"}.`
      : "Spotify разложил артистов по тому, насколько активно ты их слушаешь.";
    return `<section class="card">
      <div class="card-head"><div><h2>Ты и твои артисты</h2><p>Как Spotify оценивает тебя как слушателя каждого артиста.</p></div></div>
      <p class="say" style="margin-bottom:16px">${lead}</p>
      <div class="levels">${levels.map(([k, label, en]) => `<div class="level lv-${k}"><b>${fmt(m.counts[k])}</b><span>${label}</span><small>${en}</small></div>`).join("")}</div>
      ${supers ? `<div class="fan-block"><h3>Ты среди самых преданных слушателей</h3><div class="chips">${supers}</div></div>` : ""}
      ${past ? `<div class="fan-block"><h3>Раньше слушал(а) больше, но они до сих пор в твоих плейлистах</h3>
        <div class="chips">${past}</div>
        ${m.previous_in_playlists_count > m.previous_in_playlists.length ? `<p class="small muted" style="margin-top:8px">И ещё ${fmt(m.previous_in_playlists_count - m.previous_in_playlists.length)} таких артистов.</p>` : ""}</div>` : ""}
    </section>`;
  }

  function weeks(p) {
    const c = p.sound_capsule;
    if (!c || !c.available || !c.weeks.length) return "";
    const ws = c.weeks, max = Math.max(...ws.map((w) => w.hours), 0.1);
    const best = ws.reduce((a, b) => (b.hours > a.hours ? b : a));
    // «Отметки недели» без пояснений от Spotify непонятны обычному человеку — в «Обзор» их не берём
    const hl = c.highlights.filter((h) => !(h.type === "MILESTONE" && h.text.startsWith("Отметки"))).slice(0, 8);
    return `<section class="card">
      <div class="card-head"><div><h2>Последние недели</h2><p>Из «капсулы» Spotify: сколько играла музыка и кто был на первом месте.</p></div></div>
      <p class="say" style="margin-bottom:18px">Больше всего музыки на неделе с ${esc(dayMon(best.week))}: ${dec(best.hours.toFixed(1))} ч${best.top_artist ? `, чаще всего — <b>${esc(best.top_artist)}</b>` : ""}.</p>
      <div class="weeks" style="grid-template-columns:repeat(${ws.length}, minmax(0, 1fr))">${ws.map((w) => `<div class="wk" tabindex="0" data-tip="${esc(`Неделя с ${dayMon(w.week)}: ${dec(w.hours.toFixed(1))} ч${w.top_track ? `, трек недели — ${w.top_track}` : ""}`)}">
        <div class="wk-bar"><i class="${w === best ? "hi" : ""}" style="height:${(w.hours / max * 100).toFixed(2)}%"></i></div>
        <b class="num">${dec(w.hours.toFixed(1))} ч</b><span>${esc(w.top_artist || "—")}</span><small>с ${esc(dayMon(w.week))}</small></div>`).join("")}</div>
      ${hl.length ? `<div class="fan-block"><h3>Моменты</h3><ul class="moments">${hl.map((h) => `<li><span class="muted num">${esc(dayMon(h.date))}</span><span>${esc(h.text)}</span></li>`).join("")}</ul></div>` : ""}
    </section>`;
  }

  function wrapped(p) {
    const w = p.wrapped;
    if (!w || !w.available) return "";
    const stat = (v, label) => (v === null || v === undefined ? "" : `<div class="stat"><b>${fmt(v)}</b><span>${label}</span></div>`);
    const lines = [];
    if (w.top_track && w.top_track.track) lines.push(`Трек года — «${esc(w.top_track.track)}» (${esc(w.top_track.artist)}): ${fmt(w.top_track.plays)} ${plural(w.top_track.plays, "раз", "раза", "раз")}.`);
    else if (w.top_track) lines.push(`Трек года сыграл ${fmt(w.top_track.plays)} ${plural(w.top_track.plays, "раз", "раза", "раз")}. Название Spotify в итогах не пишет, а в твоих плейлистах этого трека нет.`);
    if (w.top_artist_minutes !== null) lines.push(`Артисту №1 года досталось ${fmt(w.top_artist_minutes)} мин${w.top_artist_share !== null ? ` — ${pct(w.top_artist_share)} всего времени` : ""}.`);
    const la = w.listening_age, phase = { early: "начала", mid: "середины", late: "конца" };
    if (la) lines.push(`Музыкальный возраст — ${la.age}${phase[la.phase] && la.decade_start ? `: тебе ближе всего музыка ${phase[la.phase]} ${la.decade_start}-х` : ""}.`);
    return `<section class="card wrapped">
      <div class="card-head"><div><h2>Итоги ${esc(w.year)} года</h2><p>По данным итогов года, которые посчитал сам Spotify.</p></div></div>
      <div class="stats wide">
        ${w.minutes !== null ? `<div class="stat"><b>${fmt(w.minutes)}</b><span>минут музыки (${fmt(Math.round(w.minutes / 60))} ч)</span></div>` : ""}
        ${stat(w.listening_days, "дней с музыкой")}
        ${w.streak_days !== null ? `<div class="stat"><b>${fmt(w.streak_days)}</b><span>${plural(w.streak_days, "день", "дня", "дней")} подряд без перерыва</span></div>` : ""}
        ${w.artists_discovered !== null ? `<div class="stat"><b>${fmt(w.artists_discovered)}</b><span>${plural(w.artists_discovered, "новый артист", "новых артиста", "новых артистов")}</span></div>` : ""}
        ${stat(w.unique_artists, "разных артистов")}
        ${stat(w.unique_tracks, "разных треков")}
      </div>
      ${lines.length ? `<div class="wrapped-lines">${lines.map((l) => `<p class="say">${l}</p>`).join("")}</div>` : ""}
    </section>`;
  }

  Lab.views.overview = {
    render(el) {
      const p = Lab.state.profile, h = p.history;
      const chips = `<div class="chips">
        ${Lab.state.isDemo ? '<span class="chip demo">Демо: артисты вымышленные</span>' : ""}
        ${p.history_kind === "basic" ? '<span class="chip">История только за последний год</span>' : ""}</div>`;
      const body = h
        ? [hero(p), `<div class="grid-2">${topArtists(h, p.aliases_merged)}${topTracks(h)}</div>`, fans(p), now(h),
           weeks(p), when(p), months(h), wrapped(p)].join("")
        : [playlistsOnly(p), fans(p), weeks(p), wrapped(p)].join("");
      el.innerHTML = chips + body + `<div class="foot"><span>Архив разобран на этом компьютере и никуда не отправлялся.</span>
        <a href="#advanced">Настройки и данные для разработки →</a></div>`;
    },
  };
})();
