// course YAML → 全日イベントの静的 .ics を生成する。
// 展開ロジックは city.tecoli の src/lib/gomi-schedule.ts categoriesOn() と等価。
import { readFileSync, readdirSync, writeFileSync, mkdirSync, statSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as yamlParse } from 'yaml';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const loadYaml = (p) => yamlParse(readFileSync(p, 'utf8'), {
  customTags: [{ tag: '!!timestamp', test: /.*/, resolve: (s) => s }],
});
const iso = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v));
const pad = (n) => String(n).padStart(2, '0');
const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const ymd = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
const nthOfMonth = (d) => Math.floor((d.getDate() - 1) / 7) + 1;
const courseSlug = (c) => c.toLowerCase().replace('-', '');
const esc = (s) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');

const DAY_TO_INDEX = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
const vocab = loadYaml(join(ROOT, 'schema/categories.yaml')).categories;

function categoriesOn(date, rules, overrides) {
  const key = isoDate(date), dow = date.getDay(), occ = nthOfMonth(date);
  const weekly = new Set(), monthly = new Set();
  for (const r of rules) {
    const matchedDay = r.days?.some((d) => DAY_TO_INDEX[d] === dow);
    if (r.pattern === 'weekly' && matchedDay) weekly.add(r.category);
    else if (r.pattern === 'monthly_nth' && matchedDay && r.occurrences?.includes(occ)) monthly.add(r.category);
    else if (r.pattern === 'monthly_specific' && (r.dates || []).map(iso).includes(key)) monthly.add(r.category);
  }
  const ovs = (overrides || []).filter((o) => iso(o.date) === key);
  if (ovs.some((o) => o.cancelled)) return [];
  if (ovs.length === 0) return [...weekly, ...monthly];
  const final = new Set(weekly);
  for (const o of ovs) if (o.category) final.add(o.category);
  return [...final];
}

const labelOf = (cat, taxOv) => taxOv?.[cat]?.label ?? vocab[cat]?.label ?? cat;

// (handle, slug) ごとに全年度の VEVENT を集約
const muniDir = join(ROOT, 'municipalities');
const OUT = join(ROOT, 'ics');
if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true });

const handles = readdirSync(muniDir).filter((h) => statSync(join(muniDir, h)).isDirectory());
let count = 0;
for (const handle of handles) {
  const dir = join(muniDir, handle);
  const taxOv = (loadYaml(join(dir, 'taxonomy.yaml')).overrides) || {};
  // slug -> { courseLabel, dtstamp, events: [{day,next,title}] }
  const bySlug = new Map();
  for (const entry of readdirSync(dir)) {
    if (!/^\d{4}$/.test(entry)) continue;
    for (const f of readdirSync(join(dir, entry))) {
      if (!/^course-.*\.yaml$/.test(f)) continue;
      const { metadata: m, rules, overrides = [] } = loadYaml(join(dir, entry, f));
      const slug = courseSlug(m.course);
      const fy = m.year;
      const start = new Date(fy, 3, 1), end = new Date(fy + 1, 3, 1);
      const rec = bySlug.get(slug) || {
        courseLabel: `${m.course} ${m.course_name_ja ?? ''}`.trim(),
        dtstamp: `${iso(m.source.extracted_at).replace(/-/g, '')}T000000Z`,
        course: m.course, events: [],
      };
      for (let d = new Date(start); d < end; d = new Date(d.getTime() + 86400000)) {
        const cats = categoriesOn(d, rules, overrides);
        if (cats.length === 0) continue;
        rec.events.push({
          day: ymd(d),
          next: ymd(new Date(d.getTime() + 86400000)),
          title: '🗑 ' + cats.map((c) => labelOf(c, taxOv)).join('、'),
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
    count++;
  }
}
console.log(`generated ${count} .ics files under ics/`);
