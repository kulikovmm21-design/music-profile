"""Генератор ДЕМО-архива в формате экспорта данных Spotify.

Все артисты и треки здесь ВЫМЫШЛЕННЫЕ. Архив нужен только для того,
чтобы проверить парсер и статистику до прихода настоящего экспорта.

Структура повторяет настоящий архив Spotify:
  Spotify Account Data/
      StreamingHistory_music_0.json   (история за ~год, упрощённый формат)
      Playlist1.json                  (плейлисты с треками)
      YourLibrary.json                (лайкнутые треки)
  Spotify Extended Streaming History/
      Streaming_History_Audio_<годы>_0.json  (вся история, подробный формат)

Заложенные сценарии, которые парсер обязан правильно обработать:
  * у одного «артиста» два псевдонима (Northern Static / n.static96);
  * в последние 60 дней вкус смещается к другому артисту (Velvet Harbor);
  * есть пропуски треков (skipped / reason_end=fwdbtn) и короткие прослушивания;
  * есть подкаст, который не должен попасть в музыкальную статистику;
  * есть кириллица в названиях.

Запуск:  python tools/make_demo_export.py demo_export.zip
"""
from __future__ import annotations

import hashlib
import json
import random
import sys
import zipfile
from datetime import datetime, timedelta, timezone

SEED = 42

# (артист, [(трек, альбом, длительность_мс)])
CATALOG = {
    "Northern Static": [
        ("Frost Window", "Pale Lights", 214000),
        ("Neon Ferry", "Pale Lights", 251000),
        ("Lavender Tape", "Pale Lights", 188000),
        ("Ghost Signal", "Afterhours", 203000),
    ],
    "n.static96": [  # тот же человек, второй проект
        ("Hotel Ballad", "Quiet Songs", 222000),
        ("Rivers Again", "Quiet Songs", 240000),
    ],
    "Velvet Harbor": [
        ("Swimming Lanes", "Tides", 280000),
        ("Ladder Song", "Tides", 265000),
        ("Weekend Light", "Morning", 207000),
    ],
    "Ice Choir": [
        ("Sailor Glow", "Frozen", 190000),
        ("Ceremony 2002", "Frozen", 176000),
    ],
    "RAGEBOX": [
        ("Overdrive", "Red Room", 140000),
        ("Static Burn", "Red Room", 132000),
    ],
    "Платиновый Двор": [
        ("Ночной район", "Двор", 170000),
    ],
    "Old Brass Unit": [
        ("Roses of 03", "Below", 330000),
    ],
}

# Веса артистов в «старом» периоде и в последние 60 дней
WEIGHTS_OLD = {"Northern Static": 40, "n.static96": 14, "Velvet Harbor": 6,
               "Ice Choir": 15, "RAGEBOX": 12, "Платиновый Двор": 8, "Old Brass Unit": 5}
WEIGHTS_RECENT = {"Northern Static": 14, "n.static96": 5, "Velvet Harbor": 45,
                  "Ice Choir": 8, "RAGEBOX": 10, "Платиновый Двор": 6, "Old Brass Unit": 12}

START = datetime(2023, 3, 1, tzinfo=timezone.utc)
END = datetime(2025, 10, 20, tzinfo=timezone.utc)
RECENT_FROM = END - timedelta(days=60)
# Часы прослушивания (UTC) — с явным вечерне-ночным уклоном
HOURS = [0, 1, 2, 7, 12, 15, 17, 18, 19, 20, 21, 21, 22, 22, 23, 23]


def _track_uri(artist: str, title: str) -> str:
    """Детерминированный ненастоящий ID (22 символа, как у Spotify)."""
    alphabet = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
    n = int(hashlib.sha256(f"{artist}|{title}".encode()).hexdigest(), 16)
    s = ""
    for _ in range(22):
        n, r = divmod(n, 62)
        s += alphabet[r]
    return f"spotify:track:{s}"


def build(rng: random.Random):
    uris = {(a, t): _track_uri(a, t) for a, ts in CATALOG.items() for t, *_ in ts}
    extended = []
    day = START
    while day < END:
        weights = WEIGHTS_RECENT if day >= RECENT_FROM else WEIGHTS_OLD
        for _ in range(rng.randint(0, 9)):
            artist = rng.choices(list(weights), list(weights.values()))[0]
            title, album, dur = rng.choice(CATALOG[artist])
            ts = day.replace(hour=rng.choice(HOURS), minute=rng.randrange(60), second=rng.randrange(60))
            skipped = rng.random() < 0.18
            played = rng.randint(3000, 25000) if skipped else (dur if rng.random() < 0.85 else rng.randint(40000, dur))
            extended.append({
                "ts": ts.strftime("%Y-%m-%dT%H:%M:%SZ"),
                "platform": rng.choice(["android", "windows", "web_player"]),
                "ms_played": played,
                "conn_country": "NL",
                "ip_addr": "0.0.0.0",
                "master_metadata_track_name": title,
                "master_metadata_album_artist_name": artist,
                "master_metadata_album_album_name": album,
                "spotify_track_uri": uris[(artist, title)],
                "episode_name": None,
                "episode_show_name": None,
                "spotify_episode_uri": None,
                "audiobook_title": None,
                "audiobook_uri": None,
                "audiobook_chapter_uri": None,
                "audiobook_chapter_title": None,
                "reason_start": rng.choice(["trackdone", "clickrow", "fwdbtn"]),
                "reason_end": "fwdbtn" if skipped else "trackdone",
                "shuffle": rng.random() < 0.5,
                "skipped": skipped,
                "offline": False,
                "offline_timestamp": None,
                "incognito_mode": False,
            })
        # изредка подкаст — он должен быть отфильтрован из музыки
        if rng.random() < 0.05:
            extended.append({
                "ts": day.replace(hour=9).strftime("%Y-%m-%dT%H:%M:%SZ"),
                "platform": "android", "ms_played": 1800000, "conn_country": "NL", "ip_addr": "0.0.0.0",
                "master_metadata_track_name": None, "master_metadata_album_artist_name": None,
                "master_metadata_album_album_name": None, "spotify_track_uri": None,
                "episode_name": "Выпуск про звук", "episode_show_name": "Демо-подкаст",
                "spotify_episode_uri": "spotify:episode:demo", "reason_start": "clickrow",
                "reason_end": "trackdone", "shuffle": False, "skipped": None, "offline": False,
                "offline_timestamp": None, "incognito_mode": False,
            })
        day += timedelta(days=1)
    extended.sort(key=lambda r: r["ts"])

    # Упрощённая история: только последний год, другой формат полей
    year_ago = END - timedelta(days=365)
    basic = []
    for r in extended:
        ts = datetime.strptime(r["ts"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
        if ts >= year_ago and r["master_metadata_track_name"]:
            basic.append({
                "endTime": ts.strftime("%Y-%m-%d %H:%M"),
                "artistName": r["master_metadata_album_artist_name"],
                "trackName": r["master_metadata_track_name"],
                "msPlayed": r["ms_played"],
            })

    def item(artist, title, album, added):
        return {"track": {"trackName": title, "artistName": artist, "albumName": album,
                          "trackUri": uris[(artist, title)]},
                "episode": None, "audiobook": None, "localTrack": None, "addedDate": added}

    playlist_tracks = [
        item("Northern Static", "Frost Window", "Pale Lights", "2023-04-02"),
        item("Northern Static", "Neon Ferry", "Pale Lights", "2023-04-02"),
        item("n.static96", "Hotel Ballad", "Quiet Songs", "2023-06-11"),
        item("Ice Choir", "Sailor Glow", "Frozen", "2023-09-30"),
        item("Northern Static", "Ghost Signal", "Afterhours", "2024-01-15"),
        item("Velvet Harbor", "Swimming Lanes", "Tides", "2025-09-01"),
        item("Платиновый Двор", "Ночной район", "Двор", "2024-05-05"),
    ]
    playlist_tracks.append({"track": None, "episode": None, "audiobook": None,
                            "localTrack": {"uri": "spotify:local:::demo:0"}, "addedDate": "2024-02-02"})
    playlists = {"playlists": [
        {"name": ">_# (demo)", "lastModifiedDate": "2025-09-01", "description": None,
         "numberOfFollowers": 0, "items": playlist_tracks},
        {"name": "rage demo", "lastModifiedDate": "2024-11-11", "description": None,
         "numberOfFollowers": 0, "items": [
             item("RAGEBOX", "Overdrive", "Red Room", "2024-11-11"),
             item("RAGEBOX", "Static Burn", "Red Room", "2024-11-11")]},
    ]}
    library = {"tracks": [
        {"artist": a, "album": al, "track": t, "uri": uris[(a, t)]}
        for a, t, al in [("Northern Static", "Frost Window", "Pale Lights"),
                         ("Velvet Harbor", "Ladder Song", "Tides"),
                         ("Ice Choir", "Ceremony 2002", "Frozen")]
    ], "albums": [], "shows": [], "episodes": [], "bannedTracks": [], "artists": [], "bannedArtists": []}
    # --- выводы самого Spotify (тоже вымышленные) ---
    marquee = [{"artistName": a, "segment": seg} for a, seg in [
        ("Northern Static", "Super Listeners"), ("n.static96", "Moderate listeners"),
        ("Velvet Harbor", "Super Listeners"), ("Ice Choir", "Moderate listeners"),
        ("RAGEBOX", "Light listeners"), ("Old Brass Unit", "Light listeners"),
        ("Платиновый Двор", "Previously Active Listeners"), ("Paper Lanterns", "Previously Active Listeners"),
        ("Glass Avenue", "Previously Active Listeners"),
    ]]
    wrapped = {
        "topArtists": {"topArtistUris": ["spotify:artist:demo1"], "numUniqueArtists": 6, "topNPercentileFan": 0.004,
                       "topArtistMsPlayed": 223_000_000},
        "topTracks": {"topTracks": [{"trackUri": uris[("Northern Static", "Neon Ferry")], "count": 141, "msPlayed": 35_400_000}],
                      "numUniqueTracks": 15},
        "yearlyMetrics": {"totalMsListened": 4_410_000_000},
        "topAlbums": {"topAlbums": [], "numCompletedAlbums": 3, "topAlbumTimePlayed": 900},
        "topGenres": {"topGenres": [], "totalNumGenres": 11},
        "clubs": {"userClub": "DEMO_CLUB", "percentInClub": 0.1, "role": "MEMBER", "artists": []},
        "listeningAge": {"listeningAge": 27, "windowStartYear": 2000, "decadePhase": "mid"},
        "party": {"avgTrackPopularityScore": 0.41, "numListenedAlbums": 9, "multilinguistRankingScore": 1.5,
                  "weightedMsAvgTempo": 112.4, "percentListenedExplicit": 22.5, "absoluteChaosRankingScore": 6.0,
                  "percentListenedNight": 52.1, "percentListenedTopArtist": 50.6, "totalNumListeningMinutes": 73500,
                  "totalNumListeningDays": 288, "streakNumListeningDays": 41, "numArtistsDiscovered": 2,
                  "percentAngryTracks": 12.0, "percentPartyTracks": 18.0, "percentKidsTracks": 1.0},
        "topFanLeaderboard": {"artistUri": "spotify:artist:demo1",
                              "ownUserStats": {"minutesStreamed": 3716, "topXLeaderboard": 412, "countryCode": "NL"}},
    }
    capsule = {"stats": [
        {"date": d, "streamCount": 0, "secondsPlayed": sec, "topGenres": [],
         "topArtists": [{"name": a, "streamCount": n, "secondsPlayed": 1} for a, n in top],
         "topTracks": [{"name": t, "streamCount": n, "secondsPlayed": 1}]}
        for d, sec, top, t, n in [
            ("2025-09-22", 30600, [("Velvet Harbor", 38), ("Northern Static", 20)], "Swimming Lanes", 14),
            ("2025-09-29", 51400, [("Velvet Harbor", 61), ("Old Brass Unit", 22)], "Ladder Song", 19),
            ("2025-10-06", 22300, [("n.static96", 24), ("Velvet Harbor", 21)], "Hotel Ballad", 9),
            ("2025-10-13", 40100, [("Velvet Harbor", 44), ("RAGEBOX", 18)], "Weekend Light", 12),
        ]],
        "highlights": [
            {"date": "2025-10-18", "highlightType": "STREAKS", "streaksHighlight": {"entity": "Velvet Harbor", "dayStreaks": 9}},
            {"date": "2025-10-11", "highlightType": "ON_REPEAT", "onRepeatHighlight": {"entity": "Swimming Lanes", "streamCount": 21}},
            {"date": "2025-10-04", "highlightType": "YOU_STAND_OUT", "youStandOutHighlight":
                {"entity": "Old Brass Unit", "country": "NL", "secondsPlayed": 9200, "marketAvgSecondsPlayed": 1400.0}},
            {"date": "2025-09-27", "highlightType": "FIRST_TO_DISCOVER", "firstToDiscoverHighlight":
                {"entity": "Ladder Song", "country": "NL", "position": 318}},
            {"date": "2025-09-20", "highlightType": "UNLIKE_COMBINATION", "unlikeCombinationHighlight":
                {"firstEntity": "RAGEBOX", "secondEntity": "Old Brass Unit"}},
        ]}
    extras = {"Marquee.json": marquee, "Wrapped2025.json": wrapped, "YourSoundCapsule.json": capsule}
    # «Платиновый Двор» уже лежит в плейлисте выше — блок «до сих пор в плейлистах» сработает
    return extended, basic, playlists, library, extras


def main(out_path: str) -> None:
    rng = random.Random(SEED)
    extended, basic, playlists, library, extras = build(rng)
    half = len(extended) // 2
    with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED) as z:
        dump = lambda o: json.dumps(o, ensure_ascii=False, indent=2)
        z.writestr("Spotify Extended Streaming History/Streaming_History_Audio_2023-2024_0.json", dump(extended[:half]))
        z.writestr("Spotify Extended Streaming History/Streaming_History_Audio_2024-2025_1.json", dump(extended[half:]))
        z.writestr("Spotify Account Data/StreamingHistory_music_0.json", dump(basic))
        z.writestr("Spotify Account Data/Playlist1.json", dump(playlists))
        z.writestr("Spotify Account Data/YourLibrary.json", dump(library))
        z.writestr("Spotify Account Data/ReadMeFirst.txt", "DEMO archive with fictional data.\n")
        for fname, obj in extras.items():
            z.writestr(f"Spotify Account Data/{fname}", dump(obj))
    print(f"Демо-архив: {out_path} ({len(extended)} записей расширенной истории, {len(basic)} упрощённой)")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "demo_export.zip")
