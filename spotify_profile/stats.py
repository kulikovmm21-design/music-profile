"""Слой A — объективная статистика. Только арифметика, никакого ИИ.

На выходе — JSON-совместимый словарь «профиля». Его потом получает LLM,
и она обязана опираться только на эти числа и на список facts.

Определения метрик (зафиксированы здесь, чтобы не «плавали»):
  * Прослушивание засчитывается, если трек играл ≥ 30 секунд
    (тот же порог, что Spotify использует для подсчёта стримов).
  * Время прослушивания — сумма ms_played по ВСЕМ записям, включая короткие.
  * Доля артиста — его засчитанные прослушивания / все засчитанные прослушивания.
  * Эффективное число артистов = exp(энтропия Шеннона по долям артистов).
    Интуиция: «слушаешь так, как будто у тебя N одинаково любимых артистов».
  * Разнообразие = энтропия / ln(число артистов), от 0 (один артист) до 1 (все поровну).
  * Пропуск = skipped == true в расширенной истории (или reason_end == "fwdbtn").
  * Часы и дни недели считаются в часовом поясе пользователя (--tz).
"""
from __future__ import annotations

import math
from collections import Counter, defaultdict
from datetime import timedelta, timezone, tzinfo

from .catalog import STATUSES
from .extras import DECADE_PHASE, capsule_stats, half_up, marquee_stats, wrapped_stats
from .models import ExportData, Play

PLAY_THRESHOLD_MS = 30_000
WEEKDAYS_RU = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"]


def get_tz(name: str | None) -> tuple[tzinfo, str | None]:
    """Часовой пояс по имени. На Windows без пакета tzdata zoneinfo не работает —
    тогда честно откатываемся на UTC и пишем предупреждение."""
    if not name or name.upper() == "UTC":
        return timezone.utc, None
    try:
        from zoneinfo import ZoneInfo
        return ZoneInfo(name), None
    except Exception:
        return timezone.utc, (f"Часовой пояс '{name}' недоступен (на Windows: pip install tzdata) — "
                              f"часы посчитаны в UTC.")


def _r(x: float, n: int = 3) -> float:
    return round(x, n)


def _shares(counter: Counter, total: int, top_n: int, extra: dict | None = None) -> list[dict]:
    out = []
    for name, c in counter.most_common(top_n):
        row = {"name": name, "plays": c, "share": _r(c / total) if total else 0.0}
        if extra and name in extra:
            row.update(extra[name])
        out.append(row)
    return out


def _entropy(counter: Counter) -> float:
    total = sum(counter.values())
    if not total:
        return 0.0
    return -sum((c / total) * math.log(c / total) for c in counter.values() if c)


def concentration(counter: Counter) -> dict:
    total = sum(counter.values())
    if not total:
        return {"top1_share": 0.0, "top5_share": 0.0, "hhi": 0.0,
                "effective_artists": 0.0, "diversity": 0.0}
    ranked = [c for _, c in counter.most_common()]
    h = _entropy(counter)
    n = len(counter)
    return {
        "top1_share": _r(ranked[0] / total),
        "top5_share": _r(sum(ranked[:5]) / total),
        "hhi": _r(sum((c / total) ** 2 for c in ranked), 4),
        "effective_artists": _r(math.exp(h), 2),
        "diversity": _r(h / math.log(n), 3) if n > 1 else 0.0,
    }


def _part_of_day(hour: int) -> str:
    if 0 <= hour < 6:
        return "ночь"
    if hour < 12:
        return "утро"
    if hour < 18:
        return "день"
    return "вечер"


def history_stats(plays: list[Play], tz: tzinfo, recent_days: int, top_n: int,
                  has_skips: bool) -> dict:
    counted = [p for p in plays if p.ms_played >= PLAY_THRESHOLD_MS]
    total_ms = sum(p.ms_played for p in plays)
    first, last = plays[0].ts, plays[-1].ts
    local = lambda p: p.ts.astimezone(tz)

    artist_plays = Counter(p.artist for p in counted)
    artist_ms: dict[str, int] = defaultdict(int)
    for p in plays:
        artist_ms[p.artist] += p.ms_played
    track_plays = Counter((p.artist, p.track) for p in counted)
    album_plays = Counter((p.artist, p.album) for p in counted if p.album)
    n = len(counted)

    out: dict = {
        "period": {
            "first_play": local(plays[0]).isoformat(timespec="minutes"),
            "last_play": local(plays[-1]).isoformat(timespec="minutes"),
            "days_span": (last - first).days + 1,
            "active_days": len({local(p).date() for p in plays}),
        },
        "totals": {
            "records": len(plays),
            "counted_plays": n,
            "short_plays_under_30s": len(plays) - n,
            "listening_hours": _r(total_ms / 3_600_000, 1),
            "unique_artists": len(artist_plays),
            "unique_tracks": len(track_plays),
        },
        "top_artists": _shares(artist_plays, n, top_n,
                               {a: {"hours": _r(ms / 3_600_000, 1)} for a, ms in artist_ms.items()}),
        "top_tracks": [{"artist": a, "track": t, "plays": c}
                       for (a, t), c in track_plays.most_common(top_n)],
        "top_albums": [{"artist": a, "album": al, "plays": c}
                       for (a, al), c in album_plays.most_common(min(top_n, 5))],
        "concentration": concentration(artist_plays),
    }

    # --- «Сейчас» против «всего времени» -------------------------------------
    cutoff = last - timedelta(days=recent_days)
    recent = [p for p in counted if p.ts > cutoff]
    recent_artists = Counter(p.artist for p in recent)
    rn = len(recent)
    shift = []
    for a, c in recent_artists.most_common(top_n):
        s_recent = c / rn
        s_all = artist_plays[a] / n if n else 0
        shift.append({"name": a, "plays": c, "share_recent": _r(s_recent),
                      "share_all_time": _r(s_all), "delta": _r(s_recent - s_all)})
    out["recent_vs_all_time"] = {
        "recent_days": recent_days,
        "recent_counted_plays": rn,
        "reliable": rn >= 50,      # меньше 50 прослушиваний — сдвигам не доверяем
        "top_recent": shift,
        "rising": sorted([x for x in shift if x["delta"] > 0], key=lambda x: -x["delta"])[:3],
        "fading": sorted(
            [{"name": a, "share_all_time": _r(artist_plays[a] / n),
              "share_recent": _r(recent_artists.get(a, 0) / rn) if rn else 0.0,
              "delta": _r((recent_artists.get(a, 0) / rn if rn else 0) - artist_plays[a] / n)}
             for a, _ in artist_plays.most_common(top_n)],
            key=lambda x: x["delta"])[:3],
    }

    # --- Время суток и дни недели ---------------------------------------------
    hours = Counter(local(p).hour for p in counted)
    wdays = Counter(local(p).weekday() for p in counted)
    parts = Counter(_part_of_day(local(p).hour) for p in counted)
    peak_hour = max(range(24), key=lambda h: hours.get(h, 0)) if n else None
    out["time_habits"] = {
        "hour_distribution": [_r(hours.get(h, 0) / n) if n else 0.0 for h in range(24)],
        "peak_hour": peak_hour,
        "part_of_day_share": {k: _r(parts.get(k, 0) / n) if n else 0.0
                              for k in ["утро", "день", "вечер", "ночь"]},
        "weekday_share": {WEEKDAYS_RU[d]: _r(wdays.get(d, 0) / n) if n else 0.0 for d in range(7)},
    }

    # --- Динамика по месяцам и открытия ---------------------------------------
    by_month: dict[str, Counter] = defaultdict(Counter)
    for p in counted:
        by_month[local(p).strftime("%Y-%m")][p.artist] += 1
    first_heard: dict[str, str] = {}
    for p in counted:
        first_heard.setdefault(p.artist, local(p).strftime("%Y-%m"))
    new_per_month = Counter(first_heard.values())
    out["by_month"] = [
        {"month": m, "plays": sum(c.values()), "top_artist": c.most_common(1)[0][0],
         "top_artist_share": _r(c.most_common(1)[0][1] / sum(c.values())),
         "new_artists": new_per_month.get(m, 0)}
        for m, c in sorted(by_month.items())
    ]

    # --- Пропуски --------------------------------------------------------------
    if has_skips:
        known = [p for p in plays if p.skipped is not None]
        skipped = [p for p in known if p.skipped]
        per_artist_total = Counter(p.artist for p in known)
        per_artist_skip = Counter(p.artist for p in skipped)
        rates = [{"name": a, "skip_rate": _r(per_artist_skip[a] / t), "records": t}
                 for a, t in per_artist_total.items() if t >= 30]
        out["skips"] = {
            "available": True,
            "skip_rate": _r(len(skipped) / len(known)) if known else 0.0,
            "most_skipped_artists": sorted(rates, key=lambda x: -x["skip_rate"])[:3],
            "least_skipped_artists": sorted(rates, key=lambda x: x["skip_rate"])[:3],
        }
    else:
        out["skips"] = {"available": False, "reason": "в упрощённой истории нет данных о пропусках"}
    return out


def playlist_stats(data: ExportData, top_n: int) -> list[dict]:
    res = []
    for pl in data.playlists:
        artists = Counter(t.artist for t in pl.tracks)
        n = len(pl.tracks)
        dates = sorted(t.added for t in pl.tracks if t.added)
        res.append({
            "name": pl.name,
            "track_count": n,
            "unreadable_items": pl.skipped_items,
            "unique_artists": len(artists),
            "top_artists": _shares(artists, n, min(top_n, 5)),
            "concentration": concentration(artists),
            "added_from": dates[0] if dates else None,
            "added_to": dates[-1] if dates else None,
            "tracks": [{"artist": t.artist, "track": t.track} for t in pl.tracks],
        })
    return res


def _plural(n: int, one: str, few: str, many: str) -> str:
    a, b = abs(n) % 100, abs(n) % 10
    return many if 10 < a < 20 else one if b == 1 else few if 2 <= b <= 4 else many


def _gen_artists(n: int) -> str:
    """«у 1 артиста», «у 21 артиста», «у 5 артистов»."""
    return "артиста" if n % 10 == 1 and n % 100 != 11 else "артистов"


def build_facts(profile: dict) -> list[dict]:
    """Короткие проверенные утверждения для LLM. Каждое — с числом-основанием."""
    facts: list[dict] = []
    h = profile.get("history")
    if h:
        top = h["top_artists"][0] if h["top_artists"] else None
        if top:
            facts.append({"id": "top_artist", "value": top["share"],
                          "text": f"{top['name']} — {top['share']:.0%} всех засчитанных прослушиваний "
                                  f"({top['plays']} из {h['totals']['counted_plays']})."})
        c = h["concentration"]
        facts.append({"id": "effective_artists", "value": c["effective_artists"],
                      "text": f"Эффективное число артистов — {c['effective_artists']}: распределение "
                              f"прослушиваний такое, как будто слушаешь столько артистов поровну "
                              f"(всего разных артистов — {h['totals']['unique_artists']})."})
        r = h["recent_vs_all_time"]
        if r["reliable"] and r["top_recent"]:
            lead = r["top_recent"][0]
            if top and lead["name"] != top["name"]:
                facts.append({"id": "taste_shift", "value": lead["delta"],
                              "text": f"За последние {r['recent_days']} дней лидер — {lead['name']}: "
                                      f"{lead['share_recent']:.0%} прослушиваний против "
                                      f"{lead['share_all_time']:.0%} за всё время."})
            else:
                facts.append({"id": "taste_stable", "value": lead["share_recent"],
                              "text": f"Лидер не сменился: за последние {r['recent_days']} дней "
                                      f"{lead['name']} — {lead['share_recent']:.0%}."})
        t = h["time_habits"]
        if t["peak_hour"] is not None:
            facts.append({"id": "peak_hour", "value": t["peak_hour"],
                          "text": f"Чаще всего музыка играет в {t['peak_hour']:02d}:00–"
                                  f"{(t['peak_hour'] + 1) % 24:02d}:00; ночью (00–06) — "
                                  f"{t['part_of_day_share']['ночь']:.0%}, вечером (18–24) — "
                                  f"{t['part_of_day_share']['вечер']:.0%}."})
        s = h["skips"]
        if s.get("available"):
            facts.append({"id": "skip_rate", "value": s["skip_rate"],
                          "text": f"Пропускается {s['skip_rate']:.0%} треков."})
        facts.append({"id": "listening_time", "value": h["totals"]["listening_hours"],
                      "text": f"Всего {h['totals']['listening_hours']} ч музыки за "
                              f"{h['period']['days_span']} дн. ({h['period']['active_days']} дн. "
                              f"с прослушиваниями)."})
    m = profile.get("marquee") or {}
    if m.get("available") and m["counts"]["super"]:
        n = m["counts"]["super"]
        names = ", ".join(x["name"] for x in m["super"][:5]) + (" и др." if n > 5 else ".")
        facts.append({"id": "super_listener", "value": n,
                      "text": f"По оценке Spotify ты среди самых преданных слушателей (Super Listeners) "
                              f"у {n} {_gen_artists(n)}: {names}"})
    if m.get("available") and m["counts"]["previous"]:
        n = m["counts"]["previous"]
        text = (f"У {n} {_gen_artists(n)} ты в группе «Previously Active Listeners» — "
                f"раньше слушал(а) их активнее.")
        if m["previous_in_playlists"]:
            text += " Из них до сих пор в твоих плейлистах: " + \
                    ", ".join(x["name"] for x in m["previous_in_playlists"][:3]) + "."
        facts.append({"id": "past_artists", "value": n, "text": text})
    w = profile.get("wrapped") or {}
    if w.get("available"):
        y = w["year"]
        parts = []
        if w["minutes"] is not None:
            parts.append(f"{w['minutes']} мин музыки ({int(half_up(w['minutes'] / 60))} ч)")
        if w["listening_days"] is not None:
            parts.append(f"{w['listening_days']} дн. с музыкой")
        if w["streak_days"] is not None:
            parts.append(f"самая длинная серия — {w['streak_days']} дн. подряд")
        if parts:
            facts.append({"id": "wrapped_year", "value": w["minutes"],
                          "text": f"За {y} год по данным Spotify — " + ", ".join(parts) + "."})
        if w["artists_discovered"] is not None:
            facts.append({"id": "wrapped_discovered", "value": w["artists_discovered"],
                          "text": f"В {y} году появилось {w['artists_discovered']} "
                                  f"{_plural(w['artists_discovered'], 'новый для тебя артист', 'новых для тебя артиста', 'новых для тебя артистов')}."})
        if w["night_share"] is not None:
            facts.append({"id": "wrapped_night", "value": w["night_share"],
                          "text": f"По итогам {y} года Spotify отнёс к ночному прослушиванию "
                                  f"{int(half_up(w['night_share'] * 100))}% музыки (ночь у Spotify считается по-своему)."})
        la = w["listening_age"]
        if la:
            tail = (f": ближе всего музыка {DECADE_PHASE[la['phase']]} {la['decade_start']}-х"
                    if la.get("phase") in DECADE_PHASE and la.get("decade_start") else "")
            facts.append({"id": "listening_age", "value": la["age"],
                          "text": f"Музыкальный возраст по версии Spotify — {la['age']}{tail}."})
    c = profile.get("sound_capsule") or {}
    if c.get("available") and c["weeks"]:
        last = c["weeks"][-1]
        if last["top_artist"]:
            hours = f"{last['hours']:.1f}".replace(".", ",")
            facts.append({"id": "week_latest", "value": last["hours"],
                          "text": f"Неделя {last['week']} в капсуле Spotify: {hours} ч, "
                                  f"чаще всего — {last['top_artist']}."})
    for canonical, raws in profile.get("aliases_merged", {}).items():
        facts.append({"id": "alias_merge", "value": canonical,
                      "text": f"{canonical} объединён с псевдонимом(ами): {', '.join(raws)}."})
    return facts


def build_profile(data: ExportData, tz_name: str | None = "UTC", recent_days: int = 60,
                  top_n: int = 10, aliases_used: dict | None = None) -> dict:
    tz, tz_warning = get_tz(tz_name)
    warnings = list(data.warnings) + ([tz_warning] if tz_warning else [])
    has_skips = data.history_kind == "extended"
    profile: dict = {
        "source": "spotify_export",
        "history_kind": data.history_kind,
        "timezone": tz_name if not tz_warning else "UTC",
        "play_threshold_seconds": PLAY_THRESHOLD_MS // 1000,
        "metadata_coverage": {
            "track_title": 1.0 if data.plays or data.playlists else 0.0,
            "artist": 1.0 if data.plays or data.playlists else 0.0,
            "album": 1.0 if has_skips else 0.0,
            "skips": 1.0 if has_skips else 0.0,
            "genres": 0.0,
            "release_year": 0.0,
            "audio_features": 0.0,
            "lyrics": 0.0,
        },
        "aliases_merged": aliases_used or {},
        "history": history_stats(data.plays, tz, recent_days, top_n, has_skips) if data.plays else None,
        "podcast_plays_excluded": data.podcast_plays,
        "audiobook_plays_excluded": data.audiobook_plays,
        "playlists": playlist_stats(data, top_n),
        "library_track_count": len(data.library),
        "files": {status: [{"name": f["name"], "about": f["about"]} for f in data.files if f["status"] == status]
                  for status in STATUSES},
        "warnings": warnings,
        "limitations": [
            "Жанры, годы выпуска и аудиопризнаки в экспорте отсутствуют — их нужно получать из внешних источников.",
            "Статистика описывает привычки прослушивания, а не личность или эмоциональное состояние.",
        ],
    }
    history_plays = Counter(p.artist for p in data.plays if p.ms_played >= PLAY_THRESHOLD_MS)
    playlist_counts = Counter(t.artist for pl in data.playlists for t in pl.tracks)
    uri_to_track: dict[str, tuple[str, str]] = {}
    for t in [t for pl in data.playlists for t in pl.tracks] + list(data.library):
        if t.track_uri and t.track_uri not in uri_to_track:
            uri_to_track[t.track_uri] = (t.artist, t.track)
    profile["marquee"] = marquee_stats(data.marquee, lambda n: n, history_plays, playlist_counts)
    profile["wrapped"] = wrapped_stats(data.wrapped, uri_to_track)
    profile["sound_capsule"] = capsule_stats(data.sound_capsule, lambda n: n)
    for key, flag in (("marquee", "fan_levels"), ("wrapped", "year_summary"), ("sound_capsule", "recent_weeks")):
        profile["metadata_coverage"][flag] = 1.0 if profile[key]["available"] else 0.0
    profile["facts"] = build_facts(profile)
    return profile
