"""Сборка Лаборатории профиля.

    python3 lab/build.py            (из папки music_profile)

Делает две вещи:
  1. lab/demo-data.js           — демо-архив в виде JS-файла (нужен index.html для кнопки «Демо-архив»).
  2. lab/dist/profile_lab.html  — всё в ОДНОМ файле, чтобы отправить кому-то или опубликовать.

Для работы и правок открывай lab/index.html — он берёт файлы из папки напрямую,
пересобирать после каждой правки не нужно. Сборка нужна, только если ты поменял
генератор демо-данных или хочешь получить единый файл.
"""
import base64
import re
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent


def make_demo_js() -> str:
    with tempfile.TemporaryDirectory() as d:
        demo = Path(d, "demo_export.zip")
        subprocess.run([sys.executable, str(ROOT / "tools" / "make_demo_export.py"), str(demo)],
                       check=True, capture_output=True)
        b64 = base64.b64encode(demo.read_bytes()).decode("ascii")
    js = ("/* Демо-архив в формате экспорта Spotify (вымышленные артисты).\n"
          "   Сгенерирован tools/make_demo_export.py через lab/build.py — руками не править. */\n"
          f'window.DEMO_ZIP_B64 = "{b64}";\n')
    (HERE / "demo-data.js").write_text(js, encoding="utf-8")
    return js


def bundle() -> Path:
    html = (HERE / "index.html").read_text(encoding="utf-8")

    def inline_script(m: re.Match) -> str:
        src = m.group(1)
        if src.startswith("http"):
            return m.group(0)
        code = (HERE / src).read_text(encoding="utf-8").replace("</script", "<\\/script")
        return f"<script>/* {src} */\n{code}\n</script>"

    html = re.sub(r'<script src="([^"]+)"></script>', inline_script, html)
    css = (HERE / "styles.css").read_text(encoding="utf-8")
    html = html.replace('<link rel="stylesheet" href="styles.css">', f"<style>\n{css}</style>")
    out_dir = HERE / "dist"
    out_dir.mkdir(exist_ok=True)
    out = out_dir / "profile_lab.html"
    out.write_text(html, encoding="utf-8")
    return out


def main() -> None:
    make_demo_js()
    out = bundle()
    print(f"demo-data.js обновлён; единый файл: {out} ({out.stat().st_size // 1024} КБ)")


if __name__ == "__main__":
    main()
