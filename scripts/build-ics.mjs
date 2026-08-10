// course YAML → 全日イベントの静的 .ics を生成する。
// 展開ロジック (categoriesOn) は tools/_lib/schedule.mjs の正典実装を使う
// (city.tecoli の src/lib/gomi-schedule.ts categoriesOn() と等価)。
import { readFileSync, readdirSync, writeFileSync, mkdirSync, statSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as yamlParse } from 'yaml';
import { expandRange, PERIOD_RE, iso, pad2 as pad } from '../tools/_lib/schedule.mjs';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const loadYaml = (p) => yamlParse(readFileSync(p, 'utf8'), {
  customTags: [{ tag: '!!timestamp', test: /.*/, resolve: (s) => s }],
});
const ymd = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
const courseSlug = (c) => c.toLowerCase().replace('-', '');
const esc = (s) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');

const vocab = loadYaml(join(ROOT, 'schema/categories.yaml')).categories;

const labelOf = (cat, taxOv) => taxOv?.[cat]?.label ?? vocab[cat]?.label ?? cat;

// (handle, slug) ごとに全年度の VEVENT を集約
const muniDir = join(ROOT, 'municipalities');
const OUT = join(ROOT, 'ics');
if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true });

// municipalities/<県>/<handle>/ の2階層。handle は leaf 名。ics/ 出力は handle フラット。
const isDir = (p) => statSync(p).isDirectory();
const handles = [];
for (const pref of readdirSync(muniDir).filter((p) => isDir(join(muniDir, p)))) {
  const prefDir = join(muniDir, pref);
  for (const h of readdirSync(prefDir).filter((h) => isDir(join(prefDir, h)))) {
    handles.push({ handle: h, dir: join(prefDir, h), pref });
  }
}
let count = 0;
const indexRows = []; // 自治体コードから探せる一覧 (ics/index.csv)
const ICS_BASE = 'https://tecolicom.github.io/japan-gomi-data/ics';
for (const { handle, dir, pref } of handles) {
  // survey.yaml のみの「調査済み・未収録」ディレクトリは配信対象外
  if (!existsSync(join(dir, 'meta.yaml'))) continue;
  const meta = loadYaml(join(dir, 'meta.yaml'));
  const taxOv = (loadYaml(join(dir, 'taxonomy.yaml')).overrides) || {};
  // slug -> { courseLabel, dtstamp, events: [{day,next,title}] }
  const bySlug = new Map();
  for (const entry of readdirSync(dir)) {
    if (!PERIOD_RE.test(entry)) continue;
    for (const f of readdirSync(join(dir, entry))) {
      if (!/^course-.*\.yaml$/.test(f)) continue;
      const { metadata: m, rules, overrides = [], unknown_periods: unknown = [] } = loadYaml(join(dir, entry, f));
      const slug = courseSlug(m.course);
      // 展開範囲は収録期間そのもの。ディレクトリ名と metadata.period の食い違いは配信前に落とす。
      if (m.period !== entry) throw new Error(`${handle}/${entry}/${f}: metadata.period "${m.period}" がディレクトリ名と不一致`);
      const rec = bySlug.get(slug) || {
        courseLabel: `${m.course} ${m.course_name_ja ?? ''}`.trim(),
        dtstamp: `${iso(m.source.extracted_at).replace(/-/g, '')}T000000Z`,
        course: m.course, courseNameJa: m.course_name_ja ?? '',
        // 収録期間と出典 YAML のパス。期間は自治体ごとに違うので画面に出す
        // (course 値は course-<値>.yaml のファイル名とそのまま一致する)
        period: m.period, yamlPath: `municipalities/${pref}/${handle}/${entry}/${f}`,
        areas: (m.areas || []).map((a) => a.name), events: [],
        // 照合用の一次ソース URL (コース別 PDF を優先。無ければ自治体の掲載ページ)
        sourceUrl: m.source?.pdf_url || m.source?.source_url || meta.source?.schedule_url || '',
      };
      for (const [key, cats] of expandRange(m.period, rules, overrides, unknown)) {
        const d = new Date(key + 'T00:00:00');
        rec.events.push({
          day: ymd(d),
          next: ymd(new Date(d.getTime() + 86400000)),
          title: '🗑 ' + cats.map((c) => labelOf(c, taxOv)).join('、'),
          cats,
        });
      }
      // 不明区間は収集日を出さない代わりに、確認を促す案内を 1 件置く。
      // 黙って消すと「収集なし」に見えるため (収集ありの断定と同じ誤り)。
      for (const u of unknown) {
        const from = new Date(iso(u.from) + 'T00:00:00'), to = new Date(iso(u.to) + 'T00:00:00');
        rec.events.push({
          day: ymd(from),
          next: ymd(new Date(to.getTime() + 86400000)),
          lastDay: ymd(to),
          title: '⚠️ 収集日は自治体の告知をご確認ください',
          cats: [],
          unknown: true,
          note: u.reason,
        });
      }
      bySlug.set(slug, rec);
    }
  }
  for (const [slug, rec] of bySlug) {
    const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//tecoli//gomi//JP', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
    L.push(`X-WR-CALNAME:${esc('ゴミ収集 ' + rec.courseLabel)}`);
    L.push('X-WR-TIMEZONE:Asia/Tokyo');
    for (const ev of rec.events) {
      L.push('BEGIN:VEVENT');
      L.push(`UID:gomi-${handle}-${rec.course}-${ev.day}@city.tecoli.com`);
      L.push(`DTSTAMP:${rec.dtstamp}`);
      L.push(`DTSTART;VALUE=DATE:${ev.day}`);
      L.push(`DTEND;VALUE=DATE:${ev.next}`);
      L.push(`SUMMARY:${esc(ev.title)}`);
      L.push('END:VEVENT');
    }
    L.push('END:VCALENDAR');
    const outDir = join(OUT, handle);
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, `${slug}.ics`), L.join('\r\n') + '\r\n');
    // 同名 .json — カレンダービュー (calendar.html) 用。日付→種別キーと自治体別ラベル・色
    const usedCats = [...new Set(rec.events.flatMap((ev) => ev.cats))];
    const isoDay = (y) => `${y.slice(0, 4)}-${y.slice(4, 6)}-${y.slice(6, 8)}`;
    writeFileSync(join(outDir, `${slug}.json`), JSON.stringify({
      city: meta.name_ja, pref, handle,
      course: rec.course, course_name_ja: rec.courseNameJa, areas: rec.areas,
      period: rec.period, yaml_path: rec.yamlPath,
      source_url: rec.sourceUrl,
      labels: Object.fromEntries(usedCats.map((c) => [c, {
        label: taxOv?.[c]?.label ?? vocab[c]?.label ?? c,
        short: taxOv?.[c]?.short ?? vocab[c]?.short ?? c,
        color: vocab[c]?.color ?? '#888',
      }])),
      // days は「収集がある日」だけ。不明区間の案内は混ぜず unknown に分けて出す
      // (days に空配列で入れると「収集なしが確定した日」と区別できなくなる)
      days: Object.fromEntries(rec.events.filter((ev) => ev.cats.length).map((ev) => [isoDay(ev.day), ev.cats])),
      ...(rec.events.some((ev) => ev.unknown) ? {
        unknown: rec.events.filter((ev) => ev.unknown).map((ev) => ({
          from: isoDay(ev.day), to: isoDay(ev.lastDay), reason: ev.note,
        })),
      } : {}),
    }) + '\n');
    indexRows.push({
      code: meta.code, pref, handle, name_ja: meta.name_ja,
      course: rec.course, course_name_ja: rec.courseNameJa,
      areas: rec.areas.join('；'),
      ics: `${ICS_BASE}/${handle}/${slug}.ics`,
    });
    count++;
  }
}
// ics/index.csv — 自治体コード・handle・町名からコースと ICS URL を引ける一覧
const csvEsc = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
const cols = ['code', 'pref', 'handle', 'name_ja', 'course', 'course_name_ja', 'areas', 'ics'];
indexRows.sort((a, b) => a.code.localeCompare(b.code) || a.course.localeCompare(b.course, 'ja', { numeric: true }));
writeFileSync(join(OUT, 'index.csv'),
  '﻿' + [cols.join(','), ...indexRows.map((r) => cols.map((c) => csvEsc(r[c] ?? '')).join(','))].join('\n') + '\n');
console.log(`generated ${count} .ics files under ics/ (+index.csv ${indexRows.length} rows)`);
