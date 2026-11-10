// 法令用語の読み仮名（Issue #129。仕様書「法令用語にはふりがなを付ける」）。DB にも画面にも触れない
// 3つの法令に出てくる読みにくい言葉を手で選んだ一覧（決めることA）。言葉（読み）の形で書き、送り仮名は括弧の外に置く。
// 「当該」「又は」のように何百回も出てくる言葉は、行が読み仮名だらけになるので入れない

const GLOSSARY = [
	'役務(えきむ)',
	'勧誘(かんゆう)',
	'誘引(ゆういん)',
	'履行(りこう)',
	'附則(ふそく)',
	'撤回(てっかい)',
	'準用(じゅんよう)',
	'是正(ぜせい)',
	'不実(ふじつ)',
	'威迫(いはく)',
	'困惑(こんわく)',
	'遅滞(ちたい)',
	'弁明(べんめい)',
	'課徴金(かちょうきん)',
	'景品類(けいひんるい)',
	'名宛人(なあてにん)',
	'割賦(かっぷ)',
	'過料(かりょう)',
	'併科(へいか)',
	'媒介(ばいかい)',
	'縦覧(じゅうらん)',
	'謄本(とうほん)',
	'抄本(しょうほん)',
	'謄写(とうしゃ)',
	'嘱託(しょくたく)',
	'追認(ついにん)',
	'過怠金(かたいきん)',
	'鑑(かんが)み',
	'承継(しょうけい)',
	'承継人(しょうけいにん)',
	'弁済(べんさい)',
	'送達(そうたつ)',
	'拘禁刑(こうきんけい)',
	'仮処分(かりしょぶん)',
	'移送(いそう)',
	'差止(さしとめ)',
	'申出(もうしで)',
	'申立(もうした)て',
	'故意(こい)',
	'虚偽(きょぎ)',
	'阻害(そがい)',
	'誇大(こだい)',
	'違約金(いやくきん)',
	'追徴(ついちょう)',
	'期日(きじつ)',
	'若(も)しくは',
	'並(なら)びに'
];

/** 読み仮名を付けた部分（rt あり）と、そのままの部分 */
export type RubySegment = { text: string; rt?: string };
type Entry = { word: string; parts: RubySegment[] };

/** 「若(も)しくは」→ 言葉「若しくは」と部分 [若/も, しくは] */
function parseEntry(source: string): Entry {
	const parts: RubySegment[] = [];
	for (const piece of source.split(/(\([^)]*\))/).filter(Boolean)) {
		if (piece.startsWith('(')) parts[parts.length - 1].rt = piece.slice(1, -1);
		else parts.push({ text: piece });
	}
	return { word: parts.map((p) => p.text).join(''), parts };
}

const ENTRIES = GLOSSARY.map(parseEntry);
const BY_WORD = new Map(ENTRIES.map((e) => [e.word, e]));
/** 長い言葉を先に試す（「承継人」を「承継」と「人」に分けない） */
const PATTERN = new RegExp(
	[...BY_WORD.keys()]
		.sort((a, b) => b.length - a.length)
		.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
		.join('|'),
	'g'
);

export function glossaryEntries(): Entry[] {
	return ENTRIES;
}

/** 文を、一覧の言葉に読み仮名を付けた部分に分ける。そのままの部分は隣どうしをつなげる */
export function rubySegments(text: string): RubySegment[] {
	const out: RubySegment[] = [];
	const plain = (t: string) => {
		if (!t) return;
		const last = out[out.length - 1];
		if (last && last.rt === undefined) last.text += t;
		else out.push({ text: t });
	};
	let at = 0;
	for (const m of text.matchAll(PATTERN)) {
		plain(text.slice(at, m.index));
		for (const p of BY_WORD.get(m[0])!.parts) {
			if (p.rt === undefined) plain(p.text);
			else out.push({ ...p });
		}
		at = m.index + m[0].length;
	}
	plain(text.slice(at));
	return out.length ? out : [{ text }];
}

/**
 * 変更点の部分ごとに読み仮名を付ける（基準6）。部分ごとに当てるので、切れ目が言葉の途中にあれば、その言葉には付かない
 */
export function rubyParts<T extends { value: string }>(parts: T[]): (T & { segments: RubySegment[] })[] {
	return parts.map((p) => ({ ...p, segments: rubySegments(p.value) }));
}
