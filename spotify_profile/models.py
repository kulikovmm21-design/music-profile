"""Единые модели данных — не зависят от того, из какого источника пришли данные.

Любой адаптер (экспорт Spotify, Last.fm, скриншоты, Яндекс Музыка) должен
приводить данные к этим структурам. Аналитика работает только с ними.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime


@dataclass(frozen=True)
class Play:
    """Одно прослушивание трека."""
    ts: datetime                 # момент (UTC, timezone-aware)
    artist: str                  # исполнитель (уже после склейки псевдонимов)
    track: str
    ms_played: int
    album: str | None = None
    track_uri: str | None = None
    raw_artist: str | None = None   # как было в источнике, до склейки
    skipped: bool | None = None     # None = источник это не сообщает
    platform: str | None = None


@dataclass(frozen=True)
class PlaylistTrack:
    artist: str
    track: str
    album: str | None = None
    track_uri: str | None = None
    added: str | None = None        # дата добавления как в источнике
    raw_artist: str | None = None


@dataclass
class Playlist:
    name: str
    tracks: list[PlaylistTrack] = field(default_factory=list)
    skipped_items: int = 0          # локальные файлы, подкасты и т.п.
    last_modified: str | None = None


@dataclass
class LibraryTrack:
    artist: str
    track: str
    album: str | None = None
    track_uri: str | None = None
    raw_artist: str | None = None


@dataclass
class ExportData:
    """Всё, что удалось достать из одного экспорта."""
    plays: list[Play] = field(default_factory=list)
    playlists: list[Playlist] = field(default_factory=list)
    library: list[LibraryTrack] = field(default_factory=list)
    podcast_plays: int = 0
    audiobook_plays: int = 0
    marquee: list[dict] = field(default_factory=list)          # [{"artistName", "segment"}] как в файле
    wrapped: list[tuple] = field(default_factory=list)         # [(год или None, объект Wrapped)]
    sound_capsule: dict | None = None
    history_kind: str = "none"      # "extended" | "basic" | "none"
    # каждый файл архива: {"name", "path", "status", "about"}; статусы — в catalog.py
    files: list[dict] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
