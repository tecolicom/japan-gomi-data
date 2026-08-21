// 一次ソース 3 点をそれぞれ構造化する。未対応の表記は throw する。
import { execFileSync } from 'node:child_process';
import { COLUMN_MAP } from './sources.mjs';

const DAY_JA = { 日: 'SU', 月: 'MO', 火: 'TU', 水: 'WE', 木: 'TH', 金: 'FR', 土: 'SA' };
const z2h = (s) => (s || '').replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));

/** CSV を行の配列に。引用符つきフィールドに対応する。 */
function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x !== ''));
}

/**
 * 県 OD の CSV → [{ name, yomi, burnDays:['MO','TH'], resDay:'TU' }]
 * 資源系 18 列は同じ曜日を持つ前提だが、**確かめてから使う** (崩れたら throw)。
 */
export function parseSchedule(text) {
  const rows = parseCsv(text.replace(/^﻿/, ''));
  const head = rows[0];
  for (const col of Object.keys(COLUMN_MAP)) {
    if (!head.includes(col)) throw new Error(`CSV に列 "${col}" が無い (県の書式が変わった可能性)`);
  }
  const iName = head.indexOf('地区名'), iYomi = head.indexOf('読み');
  if (iName < 0 || iYomi < 0) throw new Error('CSV に 地区名/読み の列が無い');

  const out = [];
  for (const r of rows.slice(1)) {
    const name = r[iName]?.trim();
    if (!name) continue;
    const burnRaw = r[head.indexOf('燃やすごみ')].trim();
    const m = burnRaw.match(/^毎週([日月火水木金土])・([日月火水木金土])$/);
    if (!m) throw new Error(`燃やすごみの表記が未対応: "${burnRaw}" (${name})`);

    // 資源系の曜日が品目間で食い違っていないか確かめる
    const resDays = new Set();
    for (const [col, cat] of Object.entries(COLUMN_MAP)) {
      if (cat === null || cat === 'burnable') continue;
      const v = r[head.indexOf(col)].trim();
      if (!v) throw new Error(`${name}: 列 "${col}" が空`);
      if (!DAY_JA[v]) throw new Error(`${name}: 列 "${col}" の曜日表記が未対応: "${v}"`);
      resDays.add(v);
    }
    if (resDays.size !== 1) {
      throw new Error(`${name}: 資源系の曜日が品目で食い違っている (${[...resDays].join(',')})。` +
        'コースを曜日ひとつで代表できないので、この抽出は使えない');
    }
    out.push({
      name, yomi: r[iYomi]?.trim() || undefined,
      burnDays: [DAY_JA[m[1]], DAY_JA[m[2]]],
      resDay: DAY_JA[[...resDays][0]],
    });
  }
  if (!out.length) throw new Error('CSV から町が 1 件も読めない');
  return out;
}

/** 内閣府 CSV → Set<'YYYY-MM-DD'> */
export function parseHolidays(buf) {
  // cp932 で配信されている
  const text = new TextDecoder('shift_jis').decode(buf);
  const rows = parseCsv(text);
  const out = new Set();
  for (const r of rows.slice(1)) {
    const m = r[0]?.trim().match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
    if (!m) continue;
    out.add(`${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`);
  }
  if (out.size < 100) throw new Error(`祝日 CSV から ${out.size} 件しか読めない (書式が変わった可能性)`);
  return out;
}

const pdfText = (path, page) =>
  execFileSync('pdftotext', ['-layout', '-f', String(page), '-l', String(page), path, '-'],
    { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });

/**
 * 年末年始 PDF の 1 ページ目 → { burn: {曜日キー: {last, resume}}, res: {曜日: {last,resume}} }
 *
 * 表は 4 ブロックの繰り返しで、1 ブロックが 3 行にまたがる。
 *   12 月 28 日（月）          12 月 22 日（火）      ← 年末最終日 (左=燃やす / 右=資源)
 *   月・木  令和 9 年   火  令和 9 年                 ← 収集曜日
 *   1月 4 日（月）             1月 5 日（火）          ← 年始開始日
 *
 * 左右の対応は「その行に現れる順」で取る。列座標に頼ると空白の揺れで崩れる。
 */
export function parseYearend(path, fiscalYear) {
  const lines = pdfText(path, 1).split('\n');
  const dec = [], jan = [], keys = [];
  for (const line of lines) {
    const t = z2h(line);
    const d = [...t.matchAll(/12\s*月\s*(\d{1,2})\s*日/g)].map((m) => Number(m[1]));
    const j = [...t.matchAll(/1\s*月\s*(\d{1,2})\s*日/g)].map((m) => Number(m[1]));
    // 収集曜日の行: 「月・木」と「火」のように 2 つ現れる
    const k = [...t.matchAll(/(?:^|\s)([日月火水木金土](?:・[日月火水木金土])?)(?=\s)/g)].map((m) => m[1]);
    if (d.length === 2) dec.push(d);
    else if (j.length === 2 && !/受入|通常/.test(t)) jan.push(j);
    else if (k.length === 2 && /令和/.test(t)) keys.push(k);
  }
  if (!(dec.length === 4 && jan.length === 4 && keys.length === 4)) {
    throw new Error(`年末年始 PDF の表が読めない (年末${dec.length}/年始${jan.length}/曜日${keys.length} ブロック。` +
      '4 ブロックを想定。PDF の書式が変わった可能性)');
  }
  const burn = {}, res = {};
  for (let i = 0; i < 4; i++) {
    const [bLast, rLast] = dec[i], [bResume, rResume] = jan[i], [bKey, rKey] = keys[i];
    burn[bKey] = { last: `${fiscalYear}-12-${String(bLast).padStart(2, '0')}`,
                   resume: `${fiscalYear + 1}-01-${String(bResume).padStart(2, '0')}` };
    res[rKey] = { last: `${fiscalYear}-12-${String(rLast).padStart(2, '0')}`,
                  resume: `${fiscalYear + 1}-01-${String(rResume).padStart(2, '0')}` };
  }
  return { burn, res };
}

/**
 * 年末年始 PDF の 2 ページ目 → 特別収集日 [{ day:'WE', date:'2026-05-06' }]
 * 「2 週連続で祝日となり通常収集ができない」場合の振替。**祝日だが収集する日**。
 */
export function parseSpecial(path, fiscalYear) {
  const lines = pdfText(path, 2).split('\n');
  const out = [];
  let pendingDay = null;
  for (const line of lines) {
    const t = z2h(line).trim();
    if (!t) continue;
    const dm = t.match(/([日月火水木金土])\s+(\d{1,2})月\s*(\d{1,2})日/);
    if (dm) {
      const mo = Number(dm[2]);
      const year = mo >= 4 ? fiscalYear : fiscalYear + 1;
      out.push({ day: DAY_JA[dm[1]],
        date: `${year}-${String(mo).padStart(2, '0')}-${String(Number(dm[3])).padStart(2, '0')}` });
      pendingDay = null;
      continue;
    }
    if (/^[日月火水木金土]$/.test(t)) { pendingDay = t; continue; }
    const only = t.match(/^(\d{1,2})月\s*(\d{1,2})日/);
    if (only && pendingDay) {
      const mo = Number(only[1]);
      const year = mo >= 4 ? fiscalYear : fiscalYear + 1;
      out.push({ day: DAY_JA[pendingDay],
        date: `${year}-${String(mo).padStart(2, '0')}-${String(Number(only[2])).padStart(2, '0')}` });
      pendingDay = null;
    }
  }
  return out;
}
