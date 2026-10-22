// みなかみ町の一次ソース: 地区別ごみ収集カレンダー PDF (令和8年度後期)。
// fetch / build / verify が共有する。
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = dirname(fileURLToPath(import.meta.url));
export const CACHE = join(HERE, 'cache');

export const INDEX_URL = 'https://www.town.minakami.gunma.jp/life/09sumai/gomi/2017-0117-1345-71.html';
const FILES_URL = 'https://www.town.minakami.gunma.jp/life/09sumai/gomi/files/';

// 案内ページの見出し「令和8年度後期(令和8年10月～令和9年3月)予定表」。これが裏付ける範囲そのもの
export const PERIOD = '2026-10--2027-03';
export const EDITION_JA = '令和8年度後期';

// 新治地区 (niiharu_1〜3) は収録しない。資源物 (かん・びん・ペットボトル、電池類・蛍光管類・古紙類) が
// 「行政区によって決められています」で日付表にも印が無く、日程の一部しか一次ソースに無いため。
// 一部だけ収録すると「資源物は収集しない」と読めてしまう (survey.yaml / meta.yaml 参照)。
const SLUGS = [
  'minakami_1', 'minakami_2', 'minakami_3', 'minakami_4', 'minakami_5', 'minakami_6',
  'tsukiyono_1', 'tsukiyono_2', 'tsukiyono_3', 'tsukiyono_4', 'tsukiyono_5',
  'tsukiyono_6', 'tsukiyono_7', 'tsukiyono_8', 'tsukiyono_9',
];

// course の値は下流の識別子なので振り直さない。1 PDF = 1 course (日程が同じ PDF も畳まない。照合を 1:1 に保つ)
export const PDFS = SLUGS.map((slug) => ({
  slug,
  course: slug.replace('_', '-'),
  url: `${FILES_URL}20261001__gomi_calendar_${slug}.pdf`,
  file: `${slug}.pdf`,
}));

// minakami_1 の注記「※須田貝・青木沢地区のプラスチックは毎週火曜日に収集します。」から作る別 course
export const PLASTIC_NOTE_COURSE = { minakami_1: 'minakami-1-sudagai' };
