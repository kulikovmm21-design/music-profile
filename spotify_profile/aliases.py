"""Склейка псевдонимов артистов.

Пример: Yung Lean и jonatan leandoer96 — один человек, но Spotify считает их
разными артистами. Без склейки статистика решит, что у слушателя «два любимых
артиста», и занизит концентрацию.

Пока словарь ведётся вручную (aliases.json). Позже его можно автоматически
пополнять из MusicBrainz (связи типа «is person» / «performs as»).

Формат aliases.json:
    {"Yung Lean": ["jonatan leandoer96"]}
Ключ — каноническое имя, значение — список псевдонимов.
"""
from __future__ import annotations

import json
from pathlib import Path


class AliasMap:
    def __init__(self, groups: dict[str, list[str]] | None = None):
        self._to_canonical: dict[str, str] = {}
        for canonical, aliases in (groups or {}).items():
            self._to_canonical[canonical.casefold()] = canonical
            for a in aliases:
                self._to_canonical[a.casefold()] = canonical

    @classmethod
    def from_file(cls, path: str | Path | None) -> "AliasMap":
        if not path:
            return cls()
        with open(path, encoding="utf-8") as f:
            return cls(json.load(f))

    def canonical(self, name: str) -> str:
        return self._to_canonical.get(name.casefold(), name)

    def groups_used(self, raw_names) -> dict[str, list[str]]:
        """Какие склейки реально сработали на этих данных (для отчёта)."""
        used: dict[str, set[str]] = {}
        for n in raw_names:
            c = self.canonical(n)
            if c != n:
                used.setdefault(c, set()).add(n)
        return {c: sorted(v) for c, v in sorted(used.items())}
