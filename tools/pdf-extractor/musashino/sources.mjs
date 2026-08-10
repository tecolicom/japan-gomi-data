// 武蔵野市の一次ソース URL とファイル名の規約 (fetch / build / verify で共有)。
export const INDEX_URL = 'https://www.city.musashino.lg.jp/gomi_kankyo/gomi/gomi_shushubi/1053782.html';
export const BASE = 'https://www.city.musashino.lg.jp/_res/projects/default_project/_page_/001/053/782';
export const DISTRICTS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
// カレンダー PDF のファイル名は c と e だけ枝番が付く (市側の差し替えの名残)
export const CAL_PDF = (d) => (d === 'c' || d === 'e' ? `2026${d}-1-1.pdf` : `2026${d}-1.pdf`);
export const LIST_PDF = (d) => `2026${d}-2.pdf`;
