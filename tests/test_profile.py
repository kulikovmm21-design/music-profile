"""Тесты: python -m unittest discover -s tests   (из папки music_profile)"""
import json
import math
import sys
import tempfile
import unittest
import zipfile
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from spotify_profile.aliases import AliasMap  # noqa: E402
from spotify_profile.parser import detect_kind, load_export  # noqa: E402
from spotify_profile.stats import build_profile, concentration, get_tz  # noqa: E402


def ext(ts, artist, track, ms=200000, skipped=False, **kw):
    r = {"ts": ts, "ms_played": ms, "master_metadata_track_name": track,
         "master_metadata_album_artist_name": artist, "master_metadata_album_album_name": "A",
         "spotify_track_uri": f"spotify:track:{artist}{track}", "episode_name": None,
         "skipped": skipped, "reason_end": "fwdbtn" if skipped else "trackdone"}
    r.update(kw)
    return r


def make_zip(files: dict) -> str:
    tmp = tempfile.NamedTemporaryFile(suffix=".zip", delete=False)
    tmp.close()
    with zipfile.ZipFile(tmp.name, "w") as z:
        for name, obj in files.items():
            z.writestr(name, obj if isinstance(obj, str) else json.dumps(obj, ensure_ascii=False))
    return tmp.name


class DetectKind(unittest.TestCase):
    def test_kinds(self):
        self.assertEqual(detect_kind([ext("2024-01-01T00:00:00Z", "a", "t")]), "extended")
        self.assertEqual(detect_kind([{"endTime": "x", "artistName": "a", "trackName": "t", "msPlayed": 1}]), "basic")
        self.assertEqual(detect_kind([{"endTime": "x", "podcastName": "p", "episodeName": "e", "msPlayed": 1}]),
                         "basic_podcast")
        self.assertEqual(detect_kind({"playlists": []}), "playlists")
        self.assertEqual(detect_kind({"tracks": [], "albums": []}), "library")
        self.assertEqual(detect_kind({"inferences": ["x"]}), "other")
        self.assertEqual(detect_kind([]), "empty")


class Parsing(unittest.TestCase):
    def test_alias_threshold_podcast_dedupe(self):
        rows = [
            ext("2024-01-01T10:00:00Z", "Yung Lean", "Kyoto"),
            ext("2024-01-02T10:00:00Z", "jonatan leandoer96", "Hotel"),
            ext("2024-01-03T10:00:00Z", "Bladee", "Ghosts", ms=10000, skipped=True),  # < 30 с
            {"ts": "2024-01-04T10:00:00Z", "ms_played": 999999, "master_metadata_track_name": None,
             "master_metadata_album_artist_name": None, "episode_name": "Подкаст"},
        ]
        path = make_zip({"a/Streaming_History_Audio_0.json": rows,
                         "a/copy_of_same.json": rows})  # дубликат файла не должен задвоить
        data = load_export(path, AliasMap({"Yung Lean": ["jonatan leandoer96"]}))
        self.assertEqual(len(data.plays), 3)
        self.assertEqual(data.podcast_plays, 1)  # подкаст не в музыке и тоже без задвоения
        p = build_profile(data)
        h = p["history"]
        self.assertEqual(h["totals"]["counted_plays"], 2)
        self.assertEqual(h["top_artists"][0], {"name": "Yung Lean", "plays": 2, "share": 1.0, "hours": 0.1})
        self.assertEqual(h["skips"]["skip_rate"], round(1 / 3, 3))

    def test_extended_preferred_over_basic(self):
        path = make_zip({
            "x/Streaming_History_Audio_0.json": [ext("2024-05-01T10:00:00Z", "A", "t")],
            "y/StreamingHistory_music_0.json": [
                {"endTime": "2024-05-01 10:03", "artistName": "A", "trackName": "t", "msPlayed": 200000}],
        })
        data = load_export(path)
        self.assertEqual(data.history_kind, "extended")
        self.assertEqual(len(data.plays), 1)
        self.assertTrue(any("задвоить" in w for w in data.warnings))

    def test_basic_only_and_folder_input(self):
        with tempfile.TemporaryDirectory() as d:
            Path(d, "StreamingHistory_music_0.json").write_text(json.dumps([
                {"endTime": "2024-05-01 22:03", "artistName": "Платина", "trackName": "Трек", "msPlayed": 120000},
                {"endTime": "2024-05-02 22:03", "artistName": "Unknown Artist", "trackName": "?", "msPlayed": 120000},
            ], ensure_ascii=False), encoding="utf-8")
            Path(d, "Inferences.json").write_text('{"inferences": ["x"]}', encoding="utf-8")
            Path(d, "broken.json").write_text("{not json", encoding="utf-8")
            data = load_export(d)
        self.assertEqual(data.history_kind, "basic")
        self.assertEqual([p.artist for p in data.plays], ["Платина"])
        statuses = {f["name"]: f["status"] for f in data.files}
        self.assertEqual(statuses["Inferences.json"], "personal_not_read")
        self.assertEqual(statuses["broken.json"], "unknown")
        p = build_profile(data)
        self.assertFalse(p["history"]["skips"]["available"])
        self.assertEqual(p["metadata_coverage"]["skips"], 0.0)

    def test_playlists_skip_local_files(self):
        path = make_zip({"Playlist1.json": {"playlists": [{"name": ">_#", "items": [
            {"track": {"trackName": "Kyoto", "artistName": "Yung Lean", "albumName": "K", "trackUri": "u"},
             "addedDate": "2024-01-01"},
            {"track": None, "localTrack": {"uri": "spotify:local:x"}, "addedDate": "2024-01-02"},
        ]}]}})
        data = load_export(path)
        self.assertEqual(len(data.playlists[0].tracks), 1)
        self.assertEqual(data.playlists[0].skipped_items, 1)


class FileCatalog(unittest.TestCase):
    """Раскладка файлов как в настоящем архиве Spotify, пересжатом на Mac."""

    def test_real_layout(self):
        d = "Spotify Account Data/"
        path = make_zip({
            d + "StreamingHistory_music_0.json": [
                {"endTime": "2026-01-01 22:00", "artistName": "Yung Lean", "trackName": "Kyoto", "msPlayed": 200000}],
            d + "StreamingHistory_podcast_0.json": [
                {"endTime": "2026-01-01 09:00", "podcastName": "P", "episodeName": "E", "msPlayed": 1000}] * 3,
            d + "StreamingHistory_audiobook_0.json": [
                {"endTime": "2026-01-01 09:00", "audiobookName": "B", "chapterName": "1", "authorName": "A", "msPlayed": 1}],
            d + "UserAddress.json": "List(Map(region -> x))",    # Spotify пишет сюда не JSON
            d + "Payments.json": [],
            d + "SearchQueries.json": [{"searchQuery": "secret"}],
            d + "Wrapped2025.json": {
                "topArtists": {"numUniqueArtists": 50, "topArtistMsPlayed": 600000},
                "topTracks": {"topTracks": [{"trackUri": "spotify:track:k", "count": 9, "msPlayed": 1800000}], "numUniqueTracks": 80},
                "yearlyMetrics": {"totalMsListened": 6000000},
                "listeningAge": {"listeningAge": 24, "windowStartYear": 2010, "decadePhase": "late"},
                "party": {"totalNumListeningMinutes": 100, "totalNumListeningDays": 21, "streakNumListeningDays": 11,
                          "numArtistsDiscovered": 22, "percentListenedNight": 48.35}},
            d + "YourSoundCapsule.json": {"stats": [
                {"date": "2026-10-26", "streamCount": 0, "secondsPlayed": 37800,
                 "topArtists": [{"name": "jonatan leandoer96", "streamCount": 51, "secondsPlayed": 1}],
                 "topTracks": [{"name": "Kyoto", "streamCount": 7, "secondsPlayed": 1}], "topGenres": []}],
                "highlights": [
                    {"date": "2026-10-25", "highlightType": "STREAKS", "streaksHighlight": {"entity": "Kyoto", "dayStreaks": 4}},
                    {"date": "2026-10-18", "highlightType": "YOU_STAND_OUT", "youStandOutHighlight":
                        {"entity": "Yung Lean", "country": "NL", "secondsPlayed": 7520, "marketAvgSecondsPlayed": 1123.685}},
                    {"date": "2026-10-11", "highlightType": "SOMETHING_NEW", "x": {}}]},
            d + "Marquee.json": [{"artistName": "Yung Lean", "segment": "Super Listeners"},
                                 {"artistName": "jonatan leandoer96", "segment": "Light listeners"},
                                 {"artistName": "Old Band", "segment": "Previously Active Listeners"}],
            d + "Playlist1.json": {"playlists": [{"name": "p", "items": [
                {"track": {"trackName": "Kyoto", "artistName": "Yung Lean", "trackUri": "spotify:track:k"}},
                {"track": {"trackName": "Old Song", "artistName": "Old Band", "trackUri": "spotify:track:o"}}]}]},
            d + "Follow.json": {"userIsFollowing": ["someone"]},
            d + "iDJAudio.json": {"filesMetadata": []},
            d + "Read_Me_First.pdf": "%PDF",
            d + "Mystery.json": {"what": 1},
            "__MACOSX/Spotify Account Data/._Wrapped2025.json": "\x00\x05binary",
            "__MACOSX/._Spotify Account Data": "\x00",
        })
        data = load_export(path, AliasMap({"Yung Lean": ["jonatan leandoer96"]}))
        st = {f["name"]: f["status"] for f in data.files}
        self.assertEqual(st["UserAddress.json"], "personal_not_read")
        self.assertEqual(st["Follow.json"], "personal_not_read")
        self.assertEqual(st["SearchQueries.json"], "personal_not_read")
        self.assertEqual(st["Payments.json"], "personal_not_read")
        self.assertEqual(st["Wrapped2025.json"], "used")
        self.assertEqual(st["Marquee.json"], "used")
        self.assertEqual(st["YourSoundCapsule.json"], "used")
        self.assertEqual(st["iDJAudio.json"], "service")
        self.assertEqual(st["Read_Me_First.pdf"], "service")
        self.assertEqual(st["Mystery.json"], "unknown")
        self.assertEqual(st["StreamingHistory_audiobook_0.json"], "used")
        self.assertFalse(any(n.startswith("._") for n in st))           # мусор macOS не показываем
        self.assertEqual(data.warnings, [w for w in data.warnings if "UserAddress" not in w])
        self.assertFalse(any("JSON" in w for w in data.warnings))       # личные файлы не открывались
        self.assertEqual((data.podcast_plays, data.audiobook_plays), (3, 1))
        p = build_profile(data)
        self.assertEqual(len(p["files"]["personal_not_read"]), 4)
        self.assertEqual(p["audiobook_plays_excluded"], 1)

        # Marquee: псевдоним склеен, остаётся более сильная группа
        m = p["marquee"]
        self.assertEqual(m["counts"], {"super": 1, "moderate": 0, "light": 0, "previous": 1, "other": 0})
        self.assertEqual(m["super"][0]["name"], "Yung Lean")
        self.assertEqual(m["super"][0]["plays_in_history"], 1)
        self.assertEqual([x["name"] for x in m["previous_in_playlists"]], ["Old Band"])
        # Wrapped: проценты 0–100 → доли, топ-трек найден по URI в плейлисте
        w = p["wrapped"]
        self.assertEqual((w["year"], w["minutes"], w["night_share"]), (2025, 100, 0.484))
        self.assertEqual(w["top_track"], {"artist": "Yung Lean", "track": "Kyoto", "plays": 9, "minutes": 30})
        self.assertEqual(w["top_artist_minutes"], 10)
        # Капсула: время берём из секунд (счётчик прослушиваний у Spotify там 0), псевдонимы склеены
        c = p["sound_capsule"]
        self.assertEqual(c["weeks"][0]["hours"], 10.5)
        self.assertEqual(c["weeks"][0]["top_artist"], "Yung Lean")
        self.assertEqual([h["text"] for h in c["highlights"]], [
            "«Kyoto» — 4 дн. подряд",
            "«Yung Lean»: 2 ч 5 мин за неделю — в 6,7 раза больше, чем у среднего слушателя в Нидерландах"])
        ids = [f["id"] for f in p["facts"]]
        for fid in ["super_listener", "past_artists", "wrapped_year", "wrapped_discovered", "wrapped_night",
                    "listening_age", "week_latest"]:
            self.assertIn(fid, ids)
        texts = {f["id"]: f["text"] for f in p["facts"]}
        self.assertEqual(texts["wrapped_discovered"], "В 2025 году появилось 22 новых для тебя артиста.")
        self.assertTrue(texts["super_listener"].endswith(": Yung Lean."))


class Metrics(unittest.TestCase):
    def test_concentration_extremes(self):
        one = concentration(Counter({"A": 10}))
        self.assertEqual(one["top1_share"], 1.0)
        self.assertEqual(one["effective_artists"], 1.0)
        self.assertEqual(one["diversity"], 0.0)
        even = concentration(Counter({"A": 5, "B": 5, "C": 5, "D": 5}))
        self.assertAlmostEqual(even["effective_artists"], 4.0, places=2)
        self.assertEqual(even["diversity"], 1.0)
        self.assertEqual(even["hhi"], 0.25)

    def test_timezone_shifts_hours(self):
        path = make_zip({"h.json": [ext("2024-01-01T22:30:00Z", "A", "t")]})
        data = load_export(path)
        utc = build_profile(data, tz_name="UTC")["history"]["time_habits"]["peak_hour"]
        tz, warn = get_tz("Europe/Moscow")
        msk = build_profile(data, tz_name="Europe/Moscow")["history"]["time_habits"]["peak_hour"]
        self.assertEqual(utc, 22)
        self.assertEqual(msk, 22 if warn else 1)  # без tzdata — честный откат на UTC

    def test_recent_shift_fact(self):
        rows = [ext(f"2024-01-{d:02d}T10:00:00Z", "Old", "t") for d in range(1, 29)] * 4
        rows = [dict(r, ts=r["ts"].replace("10:00", f"1{i % 10}:0{i % 6}")) for i, r in enumerate(rows)]
        rows += [ext(f"2024-06-{d:02d}T1{h}:00:00Z", "New", "n") for d in range(1, 29) for h in range(3)]
        data = load_export(make_zip({"h.json": rows}))
        p = build_profile(data, recent_days=60)
        ids = [f["id"] for f in p["facts"]]
        self.assertIn("taste_shift", ids)
        self.assertEqual(p["history"]["recent_vs_all_time"]["top_recent"][0]["name"], "New")


class DemoArchive(unittest.TestCase):
    def test_demo_end_to_end(self):
        sys.path.insert(0, str(ROOT / "tools"))
        import make_demo_export
        with tempfile.TemporaryDirectory() as d:
            out = str(Path(d, "demo.zip"))
            make_demo_export.main(out)
            data = load_export(out, AliasMap.from_file(ROOT / "aliases.json"))
        p = build_profile(data, tz_name="UTC")
        h = p["history"]
        self.assertEqual(h["top_artists"][0]["name"], "Northern Static")
        self.assertNotIn("n.static96", [a["name"] for a in h["top_artists"]])
        self.assertGreater(p["podcast_plays_excluded"], 0)
        shares = sum(a["share"] for a in h["top_artists"])
        self.assertTrue(math.isclose(shares, 1.0, abs_tol=0.01))


if __name__ == "__main__":
    unittest.main()
