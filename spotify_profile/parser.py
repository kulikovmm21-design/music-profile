"""Адаптер: экспорт данных Spotify (ZIP или распакованная папка) → ExportData.

Тип файла определяется по СОДЕРЖИМОМУ, а не по имени: Spotify время от времени
переименовывает файлы и папки, а пользователи их пересохраняют.

Поддерживаемые файлы:
  * расширенная история  (Streaming_History_Audio_*.json): список записей с "ts" и "ms_played";
  * упрощённая история    (StreamingHistory_music_*.json): список с "endTime" и "msPlayed";
  * упрощённая история подкастов (StreamingHistory_podcast_*.json): считаем только количество;
  * плейлисты             (Playlist*.json): объект с ключом "playlists";
  * библиотека            (YourLibrary.json): объект с ключом "tracks".
  * упрощённая история аудиокниг (StreamingHistory_audiobook_*.json): считаем только количество.
Остальные файлы раскладываются по статусам из catalog.py. Личные файлы
(адрес, платежи, переписка, поиск) не открываются вообще — решение принимается по имени.
"""
from __future__ import annotations

import json
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator

from . import catalog
from .aliases import AliasMap
from .extras import WRAPPED_YEAR
from .models import ExportData, LibraryTrack, Play, Playlist, PlaylistTrack


def _iter_files(source: str | Path) -> Iterator[tuple[str, "callable"]]:
    """Отдаёт (путь внутри архива, функция чтения байтов). Сами байты читаются только по запросу."""
    source = Path(source)
    if source.is_file() and zipfile.is_zipfile(source):
        with zipfile.ZipFile(source) as z:
            for info in z.infolist():
                if not info.is_dir():
                    yield info.filename, (lambda i=info: z.read(i))
    elif source.is_dir():
        for p in sorted(source.rglob("*")):
            if p.is_file():
                yield str(p.relative_to(source)), p.read_bytes
    else:
        raise FileNotFoundError(f"Не нашёл ZIP-архив или папку: {source}")


def _parse_json(raw: bytes) -> tuple[object | None, str | None]:
    try:
        return json.loads(raw.decode("utf-8-sig")), None
    except (ValueError, UnicodeDecodeError) as e:
        return None, f"bad json: {e}"


def _first_dict(obj) -> dict | None:
    if isinstance(obj, list):
        for x in obj:
            if isinstance(x, dict):
                return x
    return None


def detect_kind(obj) -> str:
    """Определить тип файла экспорта по его содержимому."""
    if isinstance(obj, dict):
        if isinstance(obj.get("playlists"), list):
            return "playlists"
        if isinstance(obj.get("tracks"), list):
            return "library"
        if isinstance(obj.get("stats"), list) and "highlights" in obj:
            return "sound_capsule"
        if "yearlyMetrics" in obj or ("topArtists" in obj and "party" in obj):
            return "wrapped"
        return "other"
    first = _first_dict(obj)
    if first is None:
        return "empty" if obj == [] else "other"
    if "artistName" in first and "segment" in first:
        return "marquee"
    if "ts" in first and "ms_played" in first:
        return "extended"
    if "endTime" in first and "msPlayed" in first:
        if "podcastName" in first or "episodeName" in first:
            return "basic_podcast"
        if "audiobookName" in first or "chapterName" in first:
            return "basic_audiobook"
        if "artistName" in first:
            return "basic"
    return "other"


def _parse_ext_ts(s: str) -> datetime:
    # "2024-05-01T21:13:45Z"
    return datetime.strptime(s, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)


def _parse_basic_ts(s: str) -> datetime:
    # "2024-05-01 21:13" — Spotify пишет это время в UTC
    return datetime.strptime(s, "%Y-%m-%d %H:%M").replace(tzinfo=timezone.utc)


KIND_ABOUT = {
    "extended": "расширенная история прослушиваний",
    "basic": "история прослушиваний за год",
    "basic_podcast": "история подкастов (только считаем)",
    "basic_audiobook": "история аудиокниг (только считаем)",
    "playlists": "плейлисты",
    "library": "лайки и сохранённое",
    "marquee": "насколько ты фанат каждого артиста по оценке Spotify",
    "wrapped": "итоги года от Spotify",
    "sound_capsule": "последние недели: время, топы и «моменты»",
}


def load_export(source: str | Path, aliases: AliasMap | None = None) -> ExportData:
    aliases = aliases or AliasMap()
    data = ExportData()
    extended: list[Play] = []
    basic: list[Play] = []
    seen_ext: set[tuple] = set()
    bad_records = 0
    basic_podcasts = 0
    basic_audiobooks = 0

    def mark(name: str, status: str, why: str = "") -> None:
        data.files.append({"name": name.replace("\\", "/").split("/")[-1], "path": name,
                           "status": status, "about": why})

    for name, read in _iter_files(source):
        if catalog.is_junk(name):
            continue
        known = catalog.classify_name(name)
        if known and known[0] != catalog.USED:
            mark(name, *known)           # личные файлы сюда попадают, не будучи прочитанными
            continue
        if not name.lower().endswith(".json"):
            mark(name, catalog.SERVICE, "не JSON")
            continue
        obj, err = _parse_json(read())
        if err:
            mark(name, catalog.UNKNOWN, "не удалось прочитать JSON")
            data.warnings.append(f"{name}: не удалось прочитать JSON")
            continue
        kind = detect_kind(obj)

        if kind in KIND_ABOUT:
            mark(name, catalog.USED, KIND_ABOUT[kind])

        if kind == "extended":
            for r in obj:
                try:
                    if r.get("master_metadata_track_name") and r.get("master_metadata_album_artist_name"):
                        raw = r["master_metadata_album_artist_name"]
                        key = (r["ts"], r.get("spotify_track_uri"), r.get("ms_played"))
                        if key in seen_ext:      # один и тот же файл попал дважды
                            continue
                        seen_ext.add(key)
                        skipped = r.get("skipped")
                        if skipped is None and r.get("reason_end") is not None:
                            skipped = r.get("reason_end") == "fwdbtn"
                        extended.append(Play(
                            ts=_parse_ext_ts(r["ts"]),
                            artist=aliases.canonical(raw),
                            raw_artist=raw,
                            track=r["master_metadata_track_name"],
                            album=r.get("master_metadata_album_album_name"),
                            track_uri=r.get("spotify_track_uri"),
                            ms_played=int(r.get("ms_played") or 0),
                            skipped=bool(skipped) if skipped is not None else None,
                            platform=r.get("platform"),
                        ))
                    elif r.get("audiobook_title") or r.get("audiobook_uri"):
                        key = (r["ts"], r.get("audiobook_uri") or r.get("audiobook_title"), r.get("ms_played"))
                        if key not in seen_ext:
                            seen_ext.add(key)
                            data.audiobook_plays += 1
                    elif r.get("episode_name") or r.get("spotify_episode_uri"):
                        key = (r["ts"], r.get("spotify_episode_uri") or r.get("episode_name"),
                               r.get("ms_played"))
                        if key not in seen_ext:
                            seen_ext.add(key)
                            data.podcast_plays += 1
                    # аудиокниги и пустые записи пропускаем
                except (KeyError, TypeError, ValueError):
                    bad_records += 1

        elif kind == "basic":
            for r in obj:
                try:
                    raw = r["artistName"]
                    if not raw or raw == "Unknown Artist":
                        continue
                    basic.append(Play(
                        ts=_parse_basic_ts(r["endTime"]),
                        artist=aliases.canonical(raw),
                        raw_artist=raw,
                        track=r["trackName"],
                        ms_played=int(r.get("msPlayed") or 0),
                    ))
                except (KeyError, TypeError, ValueError):
                    bad_records += 1

        elif kind == "basic_podcast":
            basic_podcasts += len(obj)

        elif kind == "basic_audiobook":
            basic_audiobooks += len(obj)

        elif kind == "playlists":
            for p in obj["playlists"]:
                pl = Playlist(name=p.get("name") or "(без названия)",
                              last_modified=p.get("lastModifiedDate"))
                for it in p.get("items") or []:
                    t = (it or {}).get("track")
                    if t and t.get("artistName") and t.get("trackName"):
                        raw = t["artistName"]
                        pl.tracks.append(PlaylistTrack(
                            artist=aliases.canonical(raw), raw_artist=raw,
                            track=t["trackName"], album=t.get("albumName"),
                            track_uri=t.get("trackUri"), added=it.get("addedDate")))
                    else:
                        pl.skipped_items += 1
                data.playlists.append(pl)

        elif kind == "library":
            for t in obj.get("tracks") or []:
                if isinstance(t, dict) and t.get("artist") and t.get("track"):
                    data.library.append(LibraryTrack(
                        artist=aliases.canonical(t["artist"]), raw_artist=t["artist"],
                        track=t["track"], album=t.get("album"), track_uri=t.get("uri")))
        elif kind == "marquee":
            data.marquee.extend({"artistName": aliases.canonical(r["artistName"]), "segment": r.get("segment")}
                                for r in obj if isinstance(r, dict) and r.get("artistName"))

        elif kind == "wrapped":
            m = WRAPPED_YEAR.search(name)
            data.wrapped.append((int(m.group(1)) if m else None, obj))

        elif kind == "sound_capsule":
            for st in obj.get("stats") or []:          # склейка псевдонимов и в недельных топах
                for a in st.get("topArtists") or []:
                    if isinstance(a, dict) and a.get("name"):
                        a["name"] = aliases.canonical(a["name"])
            data.sound_capsule = obj

        elif kind == "empty":
            mark(name, catalog.SERVICE, "пустой файл")
        else:
            mark(name, catalog.UNKNOWN, "незнакомый формат")

    # Расширенная история полнее и пересекается с упрощённой — берём только её,
    # иначе последний год посчитается дважды.
    if extended:
        data.plays = sorted(extended, key=lambda p: p.ts)
        data.history_kind = "extended"
        if basic:
            data.warnings.append(
                "Есть и расширенная, и упрощённая история — использована только расширенная, "
                "чтобы не задвоить последний год.")
    elif basic:
        data.plays = sorted(basic, key=lambda p: p.ts)
        data.history_kind = "basic"
        data.podcast_plays = basic_podcasts
        data.audiobook_plays = basic_audiobooks
        data.warnings.append(
            "Есть только упрощённая история (~последний год): нет данных о пропусках и альбомах.")
    else:
        data.podcast_plays = data.podcast_plays or basic_podcasts
        data.audiobook_plays = data.audiobook_plays or basic_audiobooks
    if bad_records:
        data.warnings.append(f"Пропущено повреждённых записей: {bad_records}")
    return data
