/* Сверка: JS-ядро панели против Python-версии на одном и том же архиве.
 * Запуск:
 *   python -m spotify_profile demo_export.zip --tz Europe/Moscow --aliases aliases.json --out py_profile.json --quiet
 *   node lab/parity_test.js demo_export.zip py_profile.json aliases.json Europe/Moscow
 * Требует npm-пакет jszip (npm i jszip@3.10.1).
 */
const fs = require("fs");
const JSZip = require(process.env.JSZIP_PATH || "jszip");
const core = require("./core.js");

(async () => {
  const [zipPath, pyPath, aliasPath, tz] = process.argv.slice(2);
  const files = await core.readZip(JSZip, fs.readFileSync(zipPath));
  const raw = core.parseFiles(files);
  const js = core.buildProfile(raw, { tz, aliases: JSON.parse(fs.readFileSync(aliasPath, "utf8")) });
  const py = JSON.parse(fs.readFileSync(pyPath, "utf8"));

  // Ключ порога в JS назван по смыслу настройки — приводим к Python-имени
  js.history.totals.short_plays_under_30s = js.history.totals.short_plays_under_threshold;
  delete js.history.totals.short_plays_under_threshold;
  // ISO-время: Python пишет смещение (+03:00), JS — нет; сравниваем без него
  for (const k of ["first_play", "last_play"]) py.history.period[k] = py.history.period[k].slice(0, 16);

  const diffs = [];
  const walk = (a, b, path) => {
    if (typeof a === "number" && typeof b === "number") {
      if (Math.abs(a - b) > 0.0011) diffs.push(`${path}: py=${a} js=${b}`);
      return;
    }
    if (Array.isArray(a) || Array.isArray(b)) {
      if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) { diffs.push(`${path}: длины ${a && a.length} / ${b && b.length}`); return; }
      a.forEach((x, i) => walk(x, b[i], `${path}[${i}]`));
      return;
    }
    if (a && typeof a === "object") {
      const keys = new Set([...Object.keys(a), ...Object.keys(b || {})]);
      for (const k of keys) walk(a[k], (b || {})[k], `${path}.${k}`);
      return;
    }
    if (a !== b) diffs.push(`${path}: py=${JSON.stringify(a)} js=${JSON.stringify(b)}`);
  };
  walk(py, js, "profile");
  if (diffs.length) { console.log(`РАСХОЖДЕНИЙ: ${diffs.length}`); console.log(diffs.slice(0, 40).join("\n")); process.exit(1); }
  console.log(`OK: JS и Python совпадают (${js.history.totals.records} записей, ${js.facts.length} фактов)`);
})();
