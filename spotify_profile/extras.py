"""Дополнительные файлы экспорта: Marquee, Wrapped<год>, YourSoundCapsule.

Это уже не история прослушиваний, а выводы самого Spotify:
  * Marquee — для каждого артиста группа слушателя (Super / Moderate / Light / Previously Active);
  * Wrapped — итоги года (минуты, дни, серии, ночное прослушивание, «музыкальный возраст»…);
    артисты, треки и жанры там записаны кодами (URI) без названий;
  * YourSoundCapsule — последние недели: время, топ артистов и треков, «хайлайты».

Тексты и округления здесь ДОЛЖНЫ совпадать с lab/core.js (проверяет lab/parity_test.js).
Поэтому округление «половина вверх» (как Math.round), а не банковское round() из Python.
"""
from __future__ import annotations

import math
import re

SEGMENTS = {
    "super listeners": "super",
    "moderate listeners": "moderate",
    "light listeners": "light",
    "previously active listeners": "previous",
}
COUNTRY_IN = {"RU": "России", "NL": "Нидерландах", "DE": "Германии", "US": "США", "GB": "Великобритании",
              "KZ": "Казахстане", "BY": "Беларуси", "UA": "Украине", "FR": "Франции", "PL": "Польше"}
DECADE_PHASE = {"early": "начала", "mid": "середины", "late": "конца"}


def half_up(x: float, n: int = 0) -> float:
    k = 10 ** n
    return math.floor(x * k + 0.5) / k


def _sort_key(name: str, plays: int):
    return (-plays, name.lower(), name)


# ---------------------------------------------------------------- Marquee
def marquee_stats(rows: list[dict], canon, history_plays: dict[str, int],
                  playlist_counts: dict[str, int], limit: int = 12) -> dict:
    if not rows:
        return {"available": False}
    groups: dict[str, list[str]] = {"super": [], "moderate": [], "light": [], "previous": [], "other": []}
    seen: dict[str, str] = {}
    order = ["super", "moderate", "light", "previous", "other"]
    for r in rows:
        name = canon(r["artistName"])
        g = SEGMENTS.get(str(r.get("segment", "")).lower(), "other")
        # если псевдонимы склеились, оставляем «самую сильную» группу
        if name in seen and order.index(seen[name]) <= order.index(g):
            continue
        if name in seen:
            groups[seen[name]].remove(name)
        seen[name] = g
        groups[g].append(name)

    def listed(names, key_counts):
        return [{"name": n, "plays_in_history": history_plays.get(n, 0), "playlist_tracks": playlist_counts.get(n, 0)}
                for n in sorted(names, key=lambda n: _sort_key(n, key_counts.get(n, 0)))]

    prev_in_pl = [x for x in listed(groups["previous"], playlist_counts) if x["playlist_tracks"] > 0]
    return {
        "available": True,
        "counts": {g: len(v) for g, v in groups.items()},
        "super": listed(groups["super"], history_plays),
        "moderate": listed(groups["moderate"], history_plays),
        "light": listed(groups["light"], history_plays)[:limit],
        "previous_in_playlists": prev_in_pl[:limit],
        "previous_in_playlists_count": len(prev_in_pl),
    }


# ---------------------------------------------------------------- Wrapped
def _num(d: dict, *path, default=None):
    for p in path:
        if not isinstance(d, dict) or p not in d:
            return default
        d = d[p]
    return d if isinstance(d, (int, float)) and not isinstance(d, bool) else default


def wrapped_stats(items: list[tuple[int | None, dict]], uri_to_track: dict[str, tuple[str, str]]) -> dict:
    if not items:
        return {"available": False}
    items = sorted(items, key=lambda x: (x[0] or 0))
    year, w = items[-1]
    party = w.get("party") or {}
    la = w.get("listeningAge") or {}
    top_tracks = (w.get("topTracks") or {}).get("topTracks") or []
    tt = top_tracks[0] if top_tracks else None
    top_track = None
    if tt:
        artist, track = uri_to_track.get(tt.get("trackUri") or "", (None, None))
        top_track = {"artist": artist, "track": track, "plays": int(tt.get("count") or 0),
                     "minutes": int(half_up((tt.get("msPlayed") or 0) / 60000))}
    minutes = _num(party, "totalNumListeningMinutes")
    if minutes is None and _num(w, "yearlyMetrics", "totalMsListened") is not None:
        minutes = int(half_up(_num(w, "yearlyMetrics", "totalMsListened") / 60000))
    pct = lambda k: half_up(_num(party, k) / 100, 3) if _num(party, k) is not None else None
    age = la.get("listeningAge") if isinstance(la.get("listeningAge"), int) else None
    out = {
        "available": True,
        "year": year,
        "years_in_archive": [y for y, _ in items if y],
        "minutes": minutes,
        "listening_days": _num(party, "totalNumListeningDays"),
        "streak_days": _num(party, "streakNumListeningDays"),
        "night_share": pct("percentListenedNight"),
        "top_artist_share": pct("percentListenedTopArtist"),
        "top_artist_minutes": int(half_up(_num(w, "topArtists", "topArtistMsPlayed") / 60000))
        if _num(w, "topArtists", "topArtistMsPlayed") is not None else None,
        "top_artist_fan_rank": _num(w, "topFanLeaderboard", "ownUserStats", "topXLeaderboard"),
        "artists_discovered": _num(party, "numArtistsDiscovered"),
        "unique_artists": _num(w, "topArtists", "numUniqueArtists"),
        "unique_tracks": _num(w, "topTracks", "numUniqueTracks"),
        "unique_genres": _num(w, "topGenres", "totalNumGenres"),
        "completed_albums": _num(w, "topAlbums", "numCompletedAlbums"),
        "listening_age": {"age": age, "decade_start": la.get("windowStartYear"), "phase": la.get("decadePhase")}
        if age is not None else None,
        "top_track": top_track,
        # Цифры, смысл которых Spotify не объясняет. Показываем только на странице для продвинутых.
        "spotify_raw": {
            "explicit_share": pct("percentListenedExplicit"),
            "angry_tracks_share": pct("percentAngryTracks"),
            "party_tracks_share": pct("percentPartyTracks"),
            "kids_tracks_share": pct("percentKidsTracks"),
            "avg_tempo_bpm": half_up(_num(party, "weightedMsAvgTempo"), 1) if _num(party, "weightedMsAvgTempo") is not None else None,
            "avg_popularity": half_up(_num(party, "avgTrackPopularityScore"), 3) if _num(party, "avgTrackPopularityScore") is not None else None,
            "multilinguist_score": half_up(_num(party, "multilinguistRankingScore"), 2) if _num(party, "multilinguistRankingScore") is not None else None,
            "chaos_score": half_up(_num(party, "absoluteChaosRankingScore"), 2) if _num(party, "absoluteChaosRankingScore") is not None else None,
            "top_artist_fan_percentile": _num(w, "topArtists", "topNPercentileFan"),
            "club": (w.get("clubs") or {}).get("userClub"),
            "club_role": (w.get("clubs") or {}).get("role"),
        },
    }
    return out


# ---------------------------------------------------------------- SoundCapsule
def duration_ru(seconds: float) -> str:
    s = int(seconds or 0)
    h, m = s // 3600, (s % 3600) // 60
    return f"{h} ч {m} мин" if h and m else f"{h} ч" if h else f"{m} мин"


def _where(cc) -> str:
    return f"в {COUNTRY_IN[cc]}" if cc in COUNTRY_IN else f"в стране {cc}" if cc else ""


def highlight_text(h: dict) -> str | None:
    t = h.get("highlightType")
    body = next((v for k, v in h.items() if k.endswith("Highlight") and isinstance(v, dict)), None) or {}
    e = body.get("entity")
    if t == "STREAKS" and e:
        return f"«{e}» — {body.get('dayStreaks')} дн. подряд"
    if t == "ON_REPEAT" and e:
        return f"«{e}» на повторе: {body.get('streamCount')} раз за неделю"
    if t == "FIRST_TO_DISCOVER" and e:
        return f"Ты среди первых слушателей «{e}»: №{body.get('position')} {_where(body.get('country'))}".rstrip()
    if t == "YOU_STAND_OUT" and e and body.get("marketAvgSecondsPlayed"):
        ratio = half_up(body.get("secondsPlayed", 0) / body["marketAvgSecondsPlayed"], 1)
        return (f"«{e}»: {duration_ru(body.get('secondsPlayed'))} за неделю — в {f'{ratio:.1f}'.replace('.', ',')} "
                f"раза больше, чем у среднего слушателя {_where(body.get('country'))}").rstrip()
    if t == "PROPORTION_LISTENING_ENTITY" and e and body.get("listeningPercentage") is not None:
        return f"«{e}» — {int(half_up(body['listeningPercentage']))}% всего, что играло за неделю"
    if t == "MILESTONE":
        if e and body.get("milestoneListeningSeconds"):
            return f"«{e}»: уже {duration_ru(body['milestoneListeningSeconds'])} прослушивания"
        ents = body.get("entities") or []
        if ents:
            more = f" и ещё {len(ents) - 3}" if len(ents) > 3 else ""
            return "Отметки недели: " + ", ".join(f"«{x}»" for x in ents[:3]) + more
    if t == "UNLIKE_COMBINATION" and body.get("firstEntity") and body.get("secondEntity"):
        return f"Необычное сочетание: «{body['firstEntity']}» и «{body['secondEntity']}»"
    return None


def capsule_stats(obj: dict | None, canon) -> dict:
    if not obj:
        return {"available": False}
    weeks = []
    for s in obj.get("stats") or []:
        ta = (s.get("topArtists") or [None])[0]
        tt = (s.get("topTracks") or [None])[0]
        weeks.append({
            "week": s.get("date"),
            "hours": half_up((s.get("secondsPlayed") or 0) / 3600, 1),
            "top_artist": canon(ta["name"]) if ta and ta.get("name") else None,
            "top_artist_plays": int(ta.get("streamCount") or 0) if ta else 0,
            "top_track": tt.get("name") if tt else None,
            "top_track_plays": int(tt.get("streamCount") or 0) if tt else 0,
            "top_artists": [canon(a["name"]) for a in (s.get("topArtists") or [])[:5] if a.get("name")],
        })
    weeks.sort(key=lambda w: w["week"] or "")
    hl = []
    for h in obj.get("highlights") or []:
        text = highlight_text(h)
        if text:
            hl.append({"date": h.get("date"), "type": h.get("highlightType"), "text": text})
    hl.sort(key=lambda x: x["date"] or "", reverse=True)
    return {"available": bool(weeks or hl), "weeks": weeks, "highlights": hl}


WRAPPED_YEAR = re.compile(r"Wrapped(\d{4})", re.IGNORECASE)
