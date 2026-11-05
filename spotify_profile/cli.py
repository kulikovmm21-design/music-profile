"""Командная строка.

    python -m spotify_profile my_spotify_data.zip
    python -m spotify_profile my_spotify_data.zip --tz Europe/Moscow --aliases aliases.json --out profile.json
"""
from __future__ import annotations

import argparse
import json
import sys

from .aliases import AliasMap
from .parser import load_export
from .stats import build_profile


def _bar(share: float, width: int = 20) -> str:
    full = round(share * width)
    return "█" * full + "·" * (width - full)


def print_summary(p: dict) -> None:
    print(f"\nИстория: {p['history_kind']}  |  часовой пояс: {p['timezone']}")
    h = p["history"]
    if h:
        t, per = h["totals"], h["period"]
        print(f"Период: {per['first_play'][:10]} → {per['last_play'][:10]}  "
              f"({per['active_days']} активных дней)")
        print(f"Прослушиваний ≥30 с: {t['counted_plays']}  |  {t['listening_hours']} ч  |  "
              f"артистов: {t['unique_artists']}  |  треков: {t['unique_tracks']}")
        print("\nТоп артистов:")
        for i, a in enumerate(h["top_artists"][:10], 1):
            print(f"  {i:>2}. {a['name'][:28]:<28} {_bar(a['share'])} {a['share']:>6.1%}  {a['plays']}")
        print("\nТоп треков:")
        for i, tr in enumerate(h["top_tracks"][:5], 1):
            print(f"  {i:>2}. {tr['artist']} — {tr['track']}  ({tr['plays']})")
        r = h["recent_vs_all_time"]
        print(f"\nПоследние {r['recent_days']} дней ({r['recent_counted_plays']} прослушиваний"
              f"{'' if r['reliable'] else ', мало данных'}):")
        for a in r["top_recent"][:5]:
            sign = "+" if a["delta"] >= 0 else ""
            print(f"      {a['name'][:28]:<28} {a['share_recent']:>6.1%}  (за всё время "
                  f"{a['share_all_time']:.1%}, {sign}{a['delta'] * 100:.1f} п.п.)")
    for pl in p["playlists"]:
        top = pl["top_artists"][0] if pl["top_artists"] else None
        print(f"\nПлейлист «{pl['name']}»: {pl['track_count']} треков, {pl['unique_artists']} артистов"
              + (f", лидер — {top['name']} ({top['share']:.0%})" if top else ""))
    if p["facts"]:
        print("\nФакты для карточки:")
        for f in p["facts"]:
            print(f"  • {f['text']}")
    f = p["files"]
    print(f"\nФайлы архива: используем {len(f['used'])}, пригодятся позже {len(f['planned'])}, "
          f"личные (не открывали) {len(f['personal_not_read'])}, служебные {len(f['service'])}, "
          f"неизвестные {len(f['unknown'])}")
    for w in p["warnings"]:
        print(f"\n⚠ {w}")


def main(argv: list[str] | None = None) -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8")  # кириллица в консоли Windows
    except (AttributeError, ValueError):
        pass
    ap = argparse.ArgumentParser(prog="spotify_profile",
                                 description="Статистика по экспорту данных Spotify")
    ap.add_argument("source", help="ZIP-архив от Spotify или распакованная папка")
    ap.add_argument("--out", default="profile.json", help="куда сохранить JSON (по умолчанию profile.json)")
    ap.add_argument("--tz", default="UTC", help="часовой пояс, например Europe/Moscow")
    ap.add_argument("--aliases", help="JSON со склейкой псевдонимов артистов")
    ap.add_argument("--recent-days", type=int, default=60, help="окно «сейчас» в днях (по умолчанию 60)")
    ap.add_argument("--top", type=int, default=10, help="размер топов")
    ap.add_argument("--quiet", action="store_true", help="не печатать сводку")
    args = ap.parse_args(argv)

    aliases = AliasMap.from_file(args.aliases)
    data = load_export(args.source, aliases)
    raw_names = [p.raw_artist for p in data.plays if p.raw_artist] + \
                [t.raw_artist for pl in data.playlists for t in pl.tracks if t.raw_artist]
    profile = build_profile(data, tz_name=args.tz, recent_days=args.recent_days, top_n=args.top,
                            aliases_used=aliases.groups_used(set(raw_names)))
    if not data.plays and not data.playlists:
        print("В архиве не нашлось ни истории прослушиваний, ни плейлистов.", file=sys.stderr)
        print("Файлы в архиве: " + ", ".join(f["name"] for f in data.files[:20]), file=sys.stderr)
        return 1
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(profile, f, ensure_ascii=False, indent=2)
    if not args.quiet:
        print_summary(profile)
    print(f"\nПрофиль сохранён: {args.out}")
    return 0
