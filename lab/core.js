/* Ядро «Лаборатории профиля»: разбор экспорта Spotify и статистика.
 * Это порт spotify_profile/parser.py + stats.py на JavaScript, чтобы всё
 * считалось прямо в браузере и архив никуда не отправлялся.
 * Определения метрик ДОЛЖНЫ совпадать с Python-версией — это проверяет
 * lab/parity_test.js на демо-архиве.
 */
(function (root) {
  "use strict";

  const WEEKDAYS_RU = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];
  const PARTS = ["утро", "день", "вечер", "ночь"];

  // ---------- псевдонимы ----------
  function makeAliasMap(groups) {
    const map = new Map();
    for (const [canonical, aliases] of Object.entries(groups || {})) {
      map.set(canonical.toLowerCase(), canonical);
      for (const a of aliases || []) map.set(String(a).toLowerCase(), canonical);
    }
    return (name) => map.get(String(name).toLowerCase()) ?? name;
  }


  // ---------- справочник файлов (повторяет spotify_profile/catalog.py) ----------
  const STATUSES = ["used", "planned", "personal_not_read", "service", "unknown"];
  const FILE_CATALOG = [
    [/^UserAddress\.json$/i, "personal_not_read", "почтовый адрес"],
    [/^Payments\.json$/i, "personal_not_read", "платежи и подписка"],
    [/^Identity\.json$/i, "personal_not_read", "имя и фото профиля"],
    [/^Identifiers\.json$/i, "personal_not_read", "почта или телефон для входа"],
    [/^UserAttributes\.json$/i, "personal_not_read", "дата рождения, пол, почта, страна"],
    [/^MessageData\.json$/i, "personal_not_read", "личные сообщения в Spotify"],
    [/^SearchQueries\.json$/i, "personal_not_read", "история поиска"],
    [/^Inferences\.json$/i, "personal_not_read", "рекламные интересы, которые приписал Spotify"],
    [/^CustomerServiceHistory\.json$/i, "personal_not_read", "обращения в поддержку"],
    [/^Family.*\.json$/i, "personal_not_read", "семейная подписка"],
    [/^Follow\.json$/i, "personal_not_read", "подписки и подписчики — имена других людей"],
    [/^iDJAudio\.json$/i, "service", "голосовые запросы к DJ"],
    [/^AgentGateway\.json$/i, "service", "диалоги с ИИ-помощником Spotify"],
    [/\.(pdf|txt|html?)$/i, "service", "инструкция Spotify к архиву"],
  ];
  const KIND_ABOUT = {
    extended: "расширенная история прослушиваний", basic: "история прослушиваний за год",
    basic_podcast: "история подкастов (только считаем)", basic_audiobook: "история аудиокниг (только считаем)",
    playlists: "плейлисты", library: "лайки и сохранённое",
    marquee: "насколько ты фанат каждого артиста по оценке Spotify",
    wrapped: "итоги года от Spotify",
    sound_capsule: "последние недели: время, топы и «моменты»",
  };
  const baseName = (path) => path.replace(/\\/g, "/").split("/").pop();
  function isJunk(path) {
    const parts = path.replace(/\\/g, "/").split("/"), last = parts[parts.length - 1];
    return parts.includes("__MACOSX") || last.startsWith("._") || last === ".DS_Store";
  }
  function classifyName(path) {
    const n = baseName(path);
    for (const [rx, status, about] of FILE_CATALOG) if (rx.test(n)) return { status, about };
    return null;
  }
  /* Решить, нужно ли вообще открывать файл. Возвращает null — открыть и разобрать,
     или готовую запись {name, pre:{status, about}} — не открывать. */
  function preclassify(path) {
    if (isJunk(path)) return { skip: true };
    const known = classifyName(path);
    if (known && known.status !== "used") return { pre: known };
    if (!path.toLowerCase().endsWith(".json")) return { pre: { status: "service", about: "не JSON" } };
    return null;
  }


  // ---------- Marquee, Wrapped, YourSoundCapsule (повторяет spotify_profile/extras.py) ----------
  const SEGMENTS = { "super listeners": "super", "moderate listeners": "moderate", "light listeners": "light",
                     "previously active listeners": "previous" };
  const COUNTRY_IN = { RU: "России", NL: "Нидерландах", DE: "Германии", US: "США", GB: "Великобритании",
                       KZ: "Казахстане", BY: "Беларуси", UA: "Украине", FR: "Франции", PL: "Польше" };
  const DECADE_PHASE = { early: "начала", mid: "середины", late: "конца" };
  const halfUp = (x, n = 0) => { const k = 10 ** n; return Math.floor(x * k + 0.5) / k; };
  const byPlaysThenName = (counts) => (a, b) => {
    const d = (counts.get(b) || 0) - (counts.get(a) || 0);
    if (d) return d;
    const la = a.toLowerCase(), lb = b.toLowerCase();
    return la < lb ? -1 : la > lb ? 1 : a < b ? -1 : a > b ? 1 : 0;
  };

  function marqueeStats(rows, canon, historyPlays, playlistCounts, limit = 12) {
    if (!rows.length) return { available: false };
    const order = ["super", "moderate", "light", "previous", "other"];
    const groups = { super: [], moderate: [], light: [], previous: [], other: [] };
    const seen = new Map();
    for (const r of rows) {
      const name = canon(r.raw);
      const g = SEGMENTS[String(r.segment == null ? "" : r.segment).toLowerCase()] || "other";
      if (seen.has(name) && order.indexOf(seen.get(name)) <= order.indexOf(g)) continue;
      if (seen.has(name)) { const arr = groups[seen.get(name)]; arr.splice(arr.indexOf(name), 1); }
      seen.set(name, g);
      groups[g].push(name);
    }
    const listed = (names, counts) => names.slice().sort(byPlaysThenName(counts)).map((n) => ({
      name: n, plays_in_history: historyPlays.get(n) || 0, playlist_tracks: playlistCounts.get(n) || 0 }));
    const prevInPl = listed(groups.previous, playlistCounts).filter((x) => x.playlist_tracks > 0);
    return {
      available: true,
      counts: Object.fromEntries(Object.entries(groups).map(([g, v]) => [g, v.length])),
      super: listed(groups.super, historyPlays),
      moderate: listed(groups.moderate, historyPlays),
      light: listed(groups.light, historyPlays).slice(0, limit),
      previous_in_playlists: prevInPl.slice(0, limit),
      previous_in_playlists_count: prevInPl.length,
    };
  }

  function num(d, ...path) {
    for (const p of path) { if (!d || typeof d !== "object" || !(p in d)) return null; d = d[p]; }
    return typeof d === "number" ? d : null;
  }

  function wrappedStats(items, uriToTrack) {
    if (!items.length) return { available: false };
    items = items.slice().sort((a, b) => (a[0] || 0) - (b[0] || 0));
    const [year, w] = items[items.length - 1];
    const party = w.party || {}, la = w.listeningAge || {};
    const tts = (w.topTracks || {}).topTracks || [];
    const tt = tts[0] || null;
    let topTrack = null;
    if (tt) {
      const found = uriToTrack.get(tt.trackUri || "") || [null, null];
      topTrack = { artist: found[0], track: found[1], plays: Math.trunc(+(tt.count || 0)),
                   minutes: Math.trunc(halfUp((tt.msPlayed || 0) / 60000)) };
    }
    let minutes = num(party, "totalNumListeningMinutes");
    if (minutes === null && num(w, "yearlyMetrics", "totalMsListened") !== null)
      minutes = Math.trunc(halfUp(num(w, "yearlyMetrics", "totalMsListened") / 60000));
    const pct = (k) => (num(party, k) !== null ? halfUp(num(party, k) / 100, 3) : null);
    const r = (k, n) => (num(party, k) !== null ? halfUp(num(party, k), n) : null);
    const age = Number.isInteger(la.listeningAge) ? la.listeningAge : null;
    const tam = num(w, "topArtists", "topArtistMsPlayed");
    const clubs = w.clubs || {};
    return {
      available: true,
      year,
      years_in_archive: items.map((x) => x[0]).filter(Boolean),
      minutes,
      listening_days: num(party, "totalNumListeningDays"),
      streak_days: num(party, "streakNumListeningDays"),
      night_share: pct("percentListenedNight"),
      top_artist_share: pct("percentListenedTopArtist"),
      top_artist_minutes: tam !== null ? Math.trunc(halfUp(tam / 60000)) : null,
      top_artist_fan_rank: num(w, "topFanLeaderboard", "ownUserStats", "topXLeaderboard"),
      artists_discovered: num(party, "numArtistsDiscovered"),
      unique_artists: num(w, "topArtists", "numUniqueArtists"),
      unique_tracks: num(w, "topTracks", "numUniqueTracks"),
      unique_genres: num(w, "topGenres", "totalNumGenres"),
      completed_albums: num(w, "topAlbums", "numCompletedAlbums"),
      listening_age: age !== null ? { age, decade_start: la.windowStartYear ?? null, phase: la.decadePhase ?? null } : null,
      top_track: topTrack,
      spotify_raw: {
        explicit_share: pct("percentListenedExplicit"),
        angry_tracks_share: pct("percentAngryTracks"),
        party_tracks_share: pct("percentPartyTracks"),
        kids_tracks_share: pct("percentKidsTracks"),
        avg_tempo_bpm: r("weightedMsAvgTempo", 1),
        avg_popularity: r("avgTrackPopularityScore", 3),
        multilinguist_score: r("multilinguistRankingScore", 2),
        chaos_score: r("absoluteChaosRankingScore", 2),
        top_artist_fan_percentile: num(w, "topArtists", "topNPercentileFan"),
        club: clubs.userClub ?? null,
        club_role: clubs.role ?? null,
      },
    };
  }

  function durationRu(seconds) {
    const s = Math.trunc(seconds || 0), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return h && m ? `${h} ч ${m} мин` : h ? `${h} ч` : `${m} мин`;
  }
  const where = (cc) => (COUNTRY_IN[cc] ? `в ${COUNTRY_IN[cc]}` : cc ? `в стране ${cc}` : "");

  function highlightText(h) {
    const t = h.highlightType;
    let body = {};
    for (const [k, v] of Object.entries(h)) if (k.endsWith("Highlight") && v && typeof v === "object" && !Array.isArray(v)) { body = v; break; }
    const e = body.entity;
    if (t === "STREAKS" && e) return `«${e}» — ${body.dayStreaks} дн. подряд`;
    if (t === "ON_REPEAT" && e) return `«${e}» на повторе: ${body.streamCount} раз за неделю`;
    if (t === "FIRST_TO_DISCOVER" && e) return `Ты среди первых слушателей «${e}»: №${body.position} ${where(body.country)}`.trimEnd();
    if (t === "YOU_STAND_OUT" && e && body.marketAvgSecondsPlayed) {
      const ratio = halfUp((body.secondsPlayed || 0) / body.marketAvgSecondsPlayed, 1);
      return (`«${e}»: ${durationRu(body.secondsPlayed)} за неделю — в ${ratio.toFixed(1).replace(".", ",")} ` +
              `раза больше, чем у среднего слушателя ${where(body.country)}`).trimEnd();
    }
    if (t === "PROPORTION_LISTENING_ENTITY" && e && body.listeningPercentage != null)
      return `«${e}» — ${Math.trunc(halfUp(body.listeningPercentage))}% всего, что играло за неделю`;
    if (t === "MILESTONE") {
      if (e && body.milestoneListeningSeconds) return `«${e}»: уже ${durationRu(body.milestoneListeningSeconds)} прослушивания`;
      const ents = body.entities || [];
      if (ents.length) return "Отметки недели: " + ents.slice(0, 3).map((x) => `«${x}»`).join(", ") + (ents.length > 3 ? ` и ещё ${ents.length - 3}` : "");
    }
    if (t === "UNLIKE_COMBINATION" && body.firstEntity && body.secondEntity)
      return `Необычное сочетание: «${body.firstEntity}» и «${body.secondEntity}»`;
    return null;
  }

  function capsuleStats(obj, canon) {
    if (!obj) return { available: false };
    const weeks = (obj.stats || []).map((s) => {
      const ta = (s.topArtists || [])[0] || null, tt = (s.topTracks || [])[0] || null;
      return {
        week: s.date ?? null,
        hours: halfUp((s.secondsPlayed || 0) / 3600, 1),
        top_artist: ta && ta.name ? canon(ta.name) : null,
        top_artist_plays: ta ? Math.trunc(+(ta.streamCount || 0)) : 0,
        top_track: tt ? tt.name ?? null : null,
        top_track_plays: tt ? Math.trunc(+(tt.streamCount || 0)) : 0,
        top_artists: (s.topArtists || []).slice(0, 5).filter((a) => a.name).map((a) => canon(a.name)),
      };
    }).sort((a, b) => ((a.week || "") < (b.week || "") ? -1 : (a.week || "") > (b.week || "") ? 1 : 0));
    const hl = [];
    for (const h of obj.highlights || []) {
      const text = highlightText(h);
      if (text) hl.push({ date: h.date ?? null, type: h.highlightType ?? null, text });
    }
    hl.sort((a, b) => ((a.date || "") < (b.date || "") ? 1 : (a.date || "") > (b.date || "") ? -1 : 0));
    return { available: !!(weeks.length || hl.length), weeks, highlights: hl };
  }

  // ---------- определение типа файла ----------
  function firstDict(obj) {
    if (Array.isArray(obj)) for (const x of obj) if (x && typeof x === "object" && !Array.isArray(x)) return x;
    return null;
  }

  function detectKind(obj) {
    if (obj && typeof obj === "object" && !Array.isArray(obj)) {
      if (Array.isArray(obj.playlists)) return "playlists";
      if (Array.isArray(obj.tracks)) return "library";
      if (Array.isArray(obj.stats) && "highlights" in obj) return "sound_capsule";
      if ("yearlyMetrics" in obj || ("topArtists" in obj && "party" in obj)) return "wrapped";
      return "other";
    }
    const first = firstDict(obj);
    if (!first) return Array.isArray(obj) && obj.length === 0 ? "empty" : "other";
    if ("artistName" in first && "segment" in first) return "marquee";
    if ("ts" in first && "ms_played" in first) return "extended";
    if ("endTime" in first && "msPlayed" in first) {
      if ("podcastName" in first || "episodeName" in first) return "basic_podcast";
      if ("audiobookName" in first || "chapterName" in first) return "basic_audiobook";
      if ("artistName" in first) return "basic";
    }
    return "other";
  }

  const parseExtTs = (s) => {
    const t = Date.parse(s);
    if (Number.isNaN(t)) throw new Error("bad ts");
    return t;
  };
  const parseBasicTs = (s) => {
    const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(s);
    if (!m) throw new Error("bad endTime");
    return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  };

  /* files: [{name, obj, err}] → сырые данные (без склейки псевдонимов,
     чтобы псевдонимы можно было менять без повторного чтения архива). */
  function parseFiles(files) {
    const data = {
      extended: [], basic: [], playlists: [], library: [],
      podcastExt: 0, podcastBasic: 0, audiobookExt: 0, audiobookBasic: 0,
      files: [], warnings: [], badRecords: 0,
      marquee: [], wrapped: [], soundCapsule: null,
    };
    const mark = (path, status, about) => data.files.push({ name: baseName(path), path, status, about: about || "" });
    const seen = new Set();
    for (const { name, obj, err, pre } of files) {
      if (pre) { mark(name, pre.status, pre.about); continue; }
      if (err) {
        mark(name, "unknown", "не удалось прочитать JSON");
        data.warnings.push(`${name}: не удалось прочитать JSON`);
        continue;
      }
      const kind = detectKind(obj);
      if (KIND_ABOUT[kind]) mark(name, "used", KIND_ABOUT[kind]);
      if (kind === "extended") {
        for (const r of obj) {
          try {
            if (r.master_metadata_track_name && r.master_metadata_album_artist_name) {
              const key = `${r.ts}|${r.spotify_track_uri}|${r.ms_played}`;
              if (seen.has(key)) continue;
              seen.add(key);
              let skipped = r.skipped;
              if ((skipped === null || skipped === undefined) && r.reason_end != null) skipped = r.reason_end === "fwdbtn";
              data.extended.push({
                ts: parseExtTs(r.ts), raw: r.master_metadata_album_artist_name,
                track: r.master_metadata_track_name, album: r.master_metadata_album_album_name || null,
                ms: +(r.ms_played || 0),
                skipped: skipped === null || skipped === undefined ? null : !!skipped,
              });
            } else if (r.audiobook_title || r.audiobook_uri) {
              const key = `${r.ts}|${r.audiobook_uri || r.audiobook_title}|${r.ms_played}`;
              if (!seen.has(key)) { seen.add(key); data.audiobookExt += 1; }
            } else if (r.episode_name || r.spotify_episode_uri) {
              const key = `${r.ts}|${r.spotify_episode_uri || r.episode_name}|${r.ms_played}`;
              if (!seen.has(key)) { seen.add(key); data.podcastExt += 1; }
            }
          } catch (e) { data.badRecords += 1; }
        }
      } else if (kind === "basic") {
        for (const r of obj) {
          try {
            const raw = r.artistName;
            if (!raw || raw === "Unknown Artist") continue;
            if (r.trackName === undefined) throw new Error("no track");
            data.basic.push({ ts: parseBasicTs(r.endTime), raw, track: r.trackName, album: null,
                              ms: +(r.msPlayed || 0), skipped: null });
          } catch (e) { data.badRecords += 1; }
        }
      } else if (kind === "basic_podcast") {
        data.podcastBasic += obj.length;
      } else if (kind === "basic_audiobook") {
        data.audiobookBasic += obj.length;
      } else if (kind === "playlists") {
        for (const p of obj.playlists) {
          const pl = { name: p.name || "(без названия)", tracks: [], skippedItems: 0 };
          for (const it of p.items || []) {
            const t = (it || {}).track;
            if (t && t.artistName && t.trackName) {
              pl.tracks.push({ raw: t.artistName, track: t.trackName, added: it.addedDate || null, uri: t.trackUri || null });
            } else pl.skippedItems += 1;
          }
          data.playlists.push(pl);
        }
      } else if (kind === "library") {
        for (const t of obj.tracks || []) if (t && t.artist && t.track) data.library.push({ raw: t.artist, track: t.track, uri: t.uri || null });
      } else if (kind === "marquee") {
        for (const r of obj) if (r && typeof r === "object" && r.artistName) data.marquee.push({ raw: r.artistName, segment: r.segment });
      } else if (kind === "wrapped") {
        const m = /Wrapped(\d{4})/i.exec(name);
        data.wrapped.push([m ? +m[1] : null, obj]);
      } else if (kind === "sound_capsule") {
        data.soundCapsule = obj;
      } else if (kind === "empty") {
        mark(name, "service", "пустой файл");
      } else {
        mark(name, "unknown", "незнакомый формат");
      }
    }
    const byTs = (a, b) => a.ts - b.ts;
    if (data.extended.length) {
      data.plays = data.extended.slice().sort(byTs);
      data.historyKind = "extended";
      data.podcastPlays = data.podcastExt;
      data.audiobookPlays = data.audiobookExt;
      if (data.basic.length) data.warnings.push(
        "Есть и расширенная, и упрощённая история — использована только расширенная, чтобы не задвоить последний год.");
    } else if (data.basic.length) {
      data.plays = data.basic.slice().sort(byTs);
      data.historyKind = "basic";
      data.podcastPlays = data.podcastBasic;
      data.audiobookPlays = data.audiobookBasic;
      data.warnings.push("Есть только упрощённая история (~последний год): нет данных о пропусках и альбомах.");
    } else {
      data.plays = [];
      data.historyKind = "none";
      data.podcastPlays = data.podcastExt || data.podcastBasic;
      data.audiobookPlays = data.audiobookExt || data.audiobookBasic;
    }
    if (data.badRecords) data.warnings.push(`Пропущено повреждённых записей: ${data.badRecords}`);
    delete data.extended; delete data.basic;
    return data;
  }

  // ---------- часовой пояс: кэш по часу UTC ----------
  function makeLocalizer(tz) {
    let fmt;
    try {
      fmt = new Intl.DateTimeFormat("en-CA", {
        timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short",
      });
    } catch (e) { return null; }
    const cache = new Map();
    const wd = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
    return (ts) => {
      // все пояса в мире смещены на кратное 15 минутам — кэшируем по 15-минутке
      const key = Math.floor(ts / 900000);
      let v = cache.get(key);
      if (!v) {
        const p = {};
        for (const { type, value } of fmt.formatToParts(new Date(key * 900000))) p[type] = value;
        v = { date: `${p.year}-${p.month}-${p.day}`, month: `${p.year}-${p.month}`,
              hour: +p.hour % 24, weekday: wd[p.weekday], min: +p.minute };
        cache.set(key, v);
      }
      return v;
    };
  }

  // ---------- метрики ----------
  const r3 = (x) => Math.round(x * 1000) / 1000;
  const rN = (x, n) => { const k = 10 ** n; return Math.round(x * k) / k; };

  function counter(items) {
    const m = new Map();
    for (const k of items) m.set(k, (m.get(k) || 0) + 1);
    return m;
  }
  // как Counter.most_common: по убыванию, при равенстве — порядок первого появления
  const mostCommon = (m, n) => {
    const arr = [...m.entries()].sort((a, b) => b[1] - a[1]);
    return n == null ? arr : arr.slice(0, n);
  };
  const sum = (it) => { let s = 0; for (const x of it) s += x; return s; };

  function concentration(m) {
    const total = sum(m.values());
    if (!total) return { top1_share: 0, top5_share: 0, hhi: 0, effective_artists: 0, diversity: 0 };
    const ranked = mostCommon(m).map((x) => x[1]);
    let h = 0;
    for (const c of ranked) if (c) h -= (c / total) * Math.log(c / total);
    const n = m.size;
    return {
      top1_share: r3(ranked[0] / total),
      top5_share: r3(sum(ranked.slice(0, 5)) / total),
      hhi: rN(sum(ranked.map((c) => (c / total) ** 2)), 4),
      effective_artists: rN(Math.exp(h), 2),
      diversity: n > 1 ? r3(h / Math.log(n)) : 0,
    };
  }

  const partOfDay = (h) => (h < 6 ? "ночь" : h < 12 ? "утро" : h < 18 ? "день" : "вечер");

  function historyStats(plays, local, o) {
    const counted = plays.filter((p) => p.ms >= o.thresholdMs);
    const n = counted.length;
    const totalMs = sum(plays.map((p) => p.ms));
    const first = plays[0], last = plays[plays.length - 1];

    const artistPlays = counter(counted.map((p) => p.artist));
    const artistMs = new Map();
    for (const p of plays) artistMs.set(p.artist, (artistMs.get(p.artist) || 0) + p.ms);
    const trackPlays = counter(counted.map((p) => p.artist + "\u0000" + p.track));
    const albumPlays = counter(counted.filter((p) => p.album).map((p) => p.artist + "\u0000" + p.album));
    const iso = (ts) => {
      const l = local(ts), m = l.min + Math.floor((ts % 900000) / 60000);  // минуты внутри 15-минутки
      return `${l.date}T${String(l.hour).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    };

    const out = {
      period: {
        first_play: iso(first.ts), last_play: iso(last.ts),
        days_span: Math.floor((last.ts - first.ts) / 86400000) + 1,
        active_days: new Set(plays.map((p) => local(p.ts).date)).size,
      },
      totals: {
        records: plays.length, counted_plays: n, short_plays_under_threshold: plays.length - n,
        listening_hours: rN(totalMs / 3600000, 1),
        unique_artists: artistPlays.size, unique_tracks: trackPlays.size,
      },
      top_artists: mostCommon(artistPlays, o.topN).map(([name, c]) => ({
        name, plays: c, share: n ? r3(c / n) : 0, hours: rN((artistMs.get(name) || 0) / 3600000, 1) })),
      top_tracks: mostCommon(trackPlays, o.topN).map(([k, c]) => {
        const [artist, track] = k.split("\u0000"); return { artist, track, plays: c }; }),
      top_albums: mostCommon(albumPlays, Math.min(o.topN, 5)).map(([k, c]) => {
        const [artist, album] = k.split("\u0000"); return { artist, album, plays: c }; }),
      concentration: concentration(artistPlays),
    };

    // сейчас против всего времени
    const cutoff = last.ts - o.recentDays * 86400000;
    const recent = counted.filter((p) => p.ts > cutoff);
    const recentArtists = counter(recent.map((p) => p.artist));
    const rn = recent.length;
    const shift = mostCommon(recentArtists, o.topN).map(([a, c]) => {
      const sr = c / rn, sa = n ? (artistPlays.get(a) || 0) / n : 0;
      return { name: a, plays: c, share_recent: r3(sr), share_all_time: r3(sa), delta: r3(sr - sa) };
    });
    out.recent_vs_all_time = {
      recent_days: o.recentDays, recent_counted_plays: rn, reliable: rn >= o.minRecentPlays, top_recent: shift,
      rising: shift.filter((x) => x.delta > 0).slice().sort((a, b) => b.delta - a.delta).slice(0, 3),
      fading: mostCommon(artistPlays, o.topN).map(([a, c]) => {
        const sr = rn ? (recentArtists.get(a) || 0) / rn : 0;
        return { name: a, share_all_time: r3(c / n), share_recent: rn ? r3(sr) : 0, delta: r3(sr - c / n) };
      }).sort((a, b) => a.delta - b.delta).slice(0, 3),
    };

    // время
    const hours = new Array(24).fill(0), wdays = new Array(7).fill(0), parts = { утро: 0, день: 0, вечер: 0, ночь: 0 };
    for (const p of counted) { const l = local(p.ts); hours[l.hour]++; wdays[l.weekday]++; parts[partOfDay(l.hour)]++; }
    let peak = null;
    if (n) { peak = 0; for (let h = 1; h < 24; h++) if (hours[h] > hours[peak]) peak = h; }
    out.time_habits = {
      hour_distribution: hours.map((c) => (n ? r3(c / n) : 0)),
      peak_hour: peak,
      part_of_day_share: Object.fromEntries(PARTS.map((k) => [k, n ? r3(parts[k] / n) : 0])),
      weekday_share: Object.fromEntries(WEEKDAYS_RU.map((d, i) => [d, n ? r3(wdays[i] / n) : 0])),
    };

    // по месяцам
    const byMonth = new Map(), firstHeard = new Map();
    for (const p of counted) {
      const m = local(p.ts).month;
      if (!byMonth.has(m)) byMonth.set(m, new Map());
      const c = byMonth.get(m); c.set(p.artist, (c.get(p.artist) || 0) + 1);
      if (!firstHeard.has(p.artist)) firstHeard.set(p.artist, m);
    }
    const newPerMonth = counter(firstHeard.values());
    out.by_month = [...byMonth.keys()].sort().map((m) => {
      const c = byMonth.get(m), tot = sum(c.values()), [top, tc] = mostCommon(c, 1)[0];
      return { month: m, plays: tot, top_artist: top, top_artist_share: r3(tc / tot), new_artists: newPerMonth.get(m) || 0 };
    });

    // пропуски
    if (o.hasSkips) {
      const known = plays.filter((p) => p.skipped !== null);
      const skipped = known.filter((p) => p.skipped);
      const tot = counter(known.map((p) => p.artist)), sk = counter(skipped.map((p) => p.artist));
      const rates = [...tot.entries()].filter(([, t]) => t >= o.minSkipRecords)
        .map(([a, t]) => ({ name: a, skip_rate: r3((sk.get(a) || 0) / t), records: t }));
      out.skips = {
        available: true,
        skip_rate: known.length ? r3(skipped.length / known.length) : 0,
        most_skipped_artists: rates.slice().sort((a, b) => b.skip_rate - a.skip_rate).slice(0, 3),
        least_skipped_artists: rates.slice().sort((a, b) => a.skip_rate - b.skip_rate).slice(0, 3),
      };
    } else {
      out.skips = { available: false, reason: "в упрощённой истории нет данных о пропусках" };
    }
    return out;
  }

  const pct0 = (x) => `${(x * 100).toFixed(0)}%`;
  const pad2 = (h) => String(h).padStart(2, "0");

  const plural = (n, one, few, many) => {
    const a = Math.abs(n) % 100, b = Math.abs(n) % 10;
    return a > 10 && a < 20 ? many : b === 1 ? one : b >= 2 && b <= 4 ? few : many;
  };
  const genArtists = (n) => (n % 10 === 1 && n % 100 !== 11 ? "артиста" : "артистов");

  function buildFacts(profile) {
    const facts = [];
    const h = profile.history;
    if (h) {
      const top = h.top_artists[0];
      if (top) facts.push({ id: "top_artist", value: top.share,
        text: `${top.name} — ${pct0(top.share)} всех засчитанных прослушиваний (${top.plays} из ${h.totals.counted_plays}).` });
      const c = h.concentration;
      facts.push({ id: "effective_artists", value: c.effective_artists,
        text: `Эффективное число артистов — ${c.effective_artists}: распределение прослушиваний такое, как будто слушаешь столько артистов поровну (всего разных артистов — ${h.totals.unique_artists}).` });
      const r = h.recent_vs_all_time;
      if (r.reliable && r.top_recent.length) {
        const lead = r.top_recent[0];
        if (top && lead.name !== top.name) facts.push({ id: "taste_shift", value: lead.delta,
          text: `За последние ${r.recent_days} дней лидер — ${lead.name}: ${pct0(lead.share_recent)} прослушиваний против ${pct0(lead.share_all_time)} за всё время.` });
        else facts.push({ id: "taste_stable", value: lead.share_recent,
          text: `Лидер не сменился: за последние ${r.recent_days} дней ${lead.name} — ${pct0(lead.share_recent)}.` });
      }
      const t = h.time_habits;
      if (t.peak_hour !== null) facts.push({ id: "peak_hour", value: t.peak_hour,
        text: `Чаще всего музыка играет в ${pad2(t.peak_hour)}:00–${pad2((t.peak_hour + 1) % 24)}:00; ночью (00–06) — ${pct0(t.part_of_day_share["ночь"])}, вечером (18–24) — ${pct0(t.part_of_day_share["вечер"])}.` });
      if (h.skips.available) facts.push({ id: "skip_rate", value: h.skips.skip_rate,
        text: `Пропускается ${pct0(h.skips.skip_rate)} треков.` });
      facts.push({ id: "listening_time", value: h.totals.listening_hours,
        text: `Всего ${h.totals.listening_hours} ч музыки за ${h.period.days_span} дн. (${h.period.active_days} дн. с прослушиваниями).` });
    }
    const m = profile.marquee || {};
    if (m.available && m.counts.super) {
      const n = m.counts.super;
      const names = m.super.slice(0, 5).map((x) => x.name).join(", ") + (n > 5 ? " и др." : ".");
      facts.push({ id: "super_listener", value: n,
        text: `По оценке Spotify ты среди самых преданных слушателей (Super Listeners) у ${n} ${genArtists(n)}: ${names}` });
    }
    if (m.available && m.counts.previous) {
      const n = m.counts.previous;
      let text = `У ${n} ${genArtists(n)} ты в группе «Previously Active Listeners» — раньше слушал(а) их активнее.`;
      if (m.previous_in_playlists.length)
        text += " Из них до сих пор в твоих плейлистах: " + m.previous_in_playlists.slice(0, 3).map((x) => x.name).join(", ") + ".";
      facts.push({ id: "past_artists", value: n, text });
    }
    const w = profile.wrapped || {};
    if (w.available) {
      const y = w.year, parts = [];
      if (w.minutes !== null) parts.push(`${w.minutes} мин музыки (${Math.trunc(halfUp(w.minutes / 60))} ч)`);
      if (w.listening_days !== null) parts.push(`${w.listening_days} дн. с музыкой`);
      if (w.streak_days !== null) parts.push(`самая длинная серия — ${w.streak_days} дн. подряд`);
      if (parts.length) facts.push({ id: "wrapped_year", value: w.minutes, text: `За ${y} год по данным Spotify — ` + parts.join(", ") + "." });
      if (w.artists_discovered !== null) facts.push({ id: "wrapped_discovered", value: w.artists_discovered,
        text: `В ${y} году появилось ${w.artists_discovered} ${plural(w.artists_discovered, "новый для тебя артист", "новых для тебя артиста", "новых для тебя артистов")}.` });
      if (w.night_share !== null) facts.push({ id: "wrapped_night", value: w.night_share,
        text: `По итогам ${y} года Spotify отнёс к ночному прослушиванию ${Math.trunc(halfUp(w.night_share * 100))}% музыки (ночь у Spotify считается по-своему).` });
      const la = w.listening_age;
      if (la) {
        const tail = DECADE_PHASE[la.phase] && la.decade_start ? `: ближе всего музыка ${DECADE_PHASE[la.phase]} ${la.decade_start}-х` : "";
        facts.push({ id: "listening_age", value: la.age, text: `Музыкальный возраст по версии Spotify — ${la.age}${tail}.` });
      }
    }
    const c = profile.sound_capsule || {};
    if (c.available && c.weeks.length) {
      const last = c.weeks[c.weeks.length - 1];
      if (last.top_artist) facts.push({ id: "week_latest", value: last.hours,
        text: `Неделя ${last.week} в капсуле Spotify: ${last.hours.toFixed(1).replace(".", ",")} ч, чаще всего — ${last.top_artist}.` });
    }
    for (const [canonical, raws] of Object.entries(profile.aliases_merged || {}))
      facts.push({ id: "alias_merge", value: canonical, text: `${canonical} объединён с псевдонимом(ами): ${raws.join(", ")}.` });
    return facts;
  }

  /* raw — результат parseFiles; o — настройки */
  function buildProfile(raw, o) {
    o = Object.assign({ tz: "UTC", recentDays: 60, topN: 10, thresholdSec: 30, aliases: {},
                         minRecentPlays: 50, minSkipRecords: 30 }, o);
    o.thresholdMs = o.thresholdSec * 1000;
    const warnings = raw.warnings.slice();
    let local = makeLocalizer(o.tz), tzUsed = o.tz;
    if (!local) { warnings.push(`Часовой пояс '${o.tz}' не распознан — часы посчитаны в UTC.`); local = makeLocalizer("UTC"); tzUsed = "UTC"; }
    const canon = makeAliasMap(o.aliases);
    const plays = raw.plays.map((p) => Object.assign({}, p, { artist: canon(p.raw) }));
    const playlists = raw.playlists.map((pl) => Object.assign({}, pl, {
      tracks: pl.tracks.map((t) => Object.assign({}, t, { artist: canon(t.raw) })) }));

    const used = {};
    for (const nm of new Set([...plays.map((p) => p.raw), ...playlists.flatMap((pl) => pl.tracks.map((t) => t.raw))])) {
      const c = canon(nm);
      if (c !== nm) (used[c] = used[c] || []).push(nm);
    }
    const aliasesMerged = {};
    for (const c of Object.keys(used).sort()) aliasesMerged[c] = used[c].sort();

    const hasSkips = raw.historyKind === "extended";
    const anyData = plays.length || playlists.length;
    const profile = {
      source: "spotify_export",
      history_kind: raw.historyKind,
      timezone: tzUsed,
      play_threshold_seconds: o.thresholdSec,
      metadata_coverage: {
        track_title: anyData ? 1 : 0, artist: anyData ? 1 : 0,
        album: hasSkips ? 1 : 0, skips: hasSkips ? 1 : 0,
        genres: 0, release_year: 0, audio_features: 0, lyrics: 0,
      },
      aliases_merged: aliasesMerged,
      history: plays.length ? historyStats(plays, local, Object.assign({}, o, { hasSkips })) : null,
      podcast_plays_excluded: raw.podcastPlays,
      audiobook_plays_excluded: raw.audiobookPlays,
      playlists: playlists.map((pl) => {
        const a = counter(pl.tracks.map((t) => t.artist)), n = pl.tracks.length;
        const dates = pl.tracks.map((t) => t.added).filter(Boolean).sort();
        return { name: pl.name, track_count: n, unreadable_items: pl.skippedItems, unique_artists: a.size,
          top_artists: mostCommon(a, Math.min(o.topN, 5)).map(([name, c]) => ({ name, plays: c, share: n ? r3(c / n) : 0 })),
          concentration: concentration(a), added_from: dates[0] || null, added_to: dates[dates.length - 1] || null,
          tracks: pl.tracks.map((t) => ({ artist: t.artist, track: t.track })) };
      }),
      library_track_count: raw.library.length,
      files: Object.fromEntries(STATUSES.map((st) => [st,
        raw.files.filter((f) => f.status === st).map((f) => ({ name: f.name, about: f.about }))])),
      warnings,
      limitations: [
        "Жанры, годы выпуска и аудиопризнаки в экспорте отсутствуют — их нужно получать из внешних источников.",
        "Статистика описывает привычки прослушивания, а не личность или эмоциональное состояние.",
      ],
    };
    const historyPlays = counter(plays.filter((p) => p.ms >= o.thresholdMs).map((p) => p.artist));
    const playlistCounts = counter(playlists.flatMap((pl) => pl.tracks.map((t) => t.artist)));
    const uriToTrack = new Map();
    for (const t of [...playlists.flatMap((pl) => pl.tracks), ...raw.library.map((t) => ({ uri: t.uri, artist: canon(t.raw), track: t.track }))])
      if (t.uri && !uriToTrack.has(t.uri)) uriToTrack.set(t.uri, [t.artist, t.track]);
    profile.marquee = marqueeStats(raw.marquee, canon, historyPlays, playlistCounts);
    profile.wrapped = wrappedStats(raw.wrapped, uriToTrack);
    profile.sound_capsule = capsuleStats(raw.soundCapsule, canon);
    for (const [key, flag] of [["marquee", "fan_levels"], ["wrapped", "year_summary"], ["sound_capsule", "recent_weeks"]])
      profile.metadata_coverage[flag] = profile[key].available ? 1 : 0;
    profile.facts = buildFacts(profile);
    return profile;
  }

  /* Чтение ZIP через JSZip (в браузере — глобальный, в Node — require). */
  /* Чтение ZIP через JSZip (в браузере — глобальный, в Node — require).
     Личные файлы не распаковываются: решение принимается по имени. */
  async function readZip(JSZip, buffer) {
    const zip = await JSZip.loadAsync(buffer);
    const files = [];
    const entries = Object.values(zip.files).filter((f) => !f.dir);  // порядок как в архиве
    for (const f of entries) {
      const pc = preclassify(f.name);
      if (pc && pc.skip) continue;
      if (pc) { files.push({ name: f.name, pre: pc.pre }); continue; }
      try {
        const text = (await f.async("string")).replace(/^\uFEFF/, "");
        files.push({ name: f.name, obj: JSON.parse(text), err: null });
      } catch (e) { files.push({ name: f.name, obj: null, err: "bad json: " + e.message }); }
    }
    return files;
  }

  const api = { detectKind, parseFiles, buildProfile, readZip, concentration, makeAliasMap, preclassify, STATUSES };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ProfileCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
