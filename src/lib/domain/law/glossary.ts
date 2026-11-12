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

/**
 * 法令用語のかんたんな説明（Issue #143 決めたことA・B）。forms は条文に出てくる形（同じ説明を付ける）。説明は1〜2文・60字まで、中学生でも読める言葉で書く。
 * 読み仮名の一覧の言葉は、その読みも出す。読めても法律では意味が違う言葉（善意・悪意など）は、読み仮名なしで説明だけ付ける。
 * 説明は運営が書いたもの。専門家からの直しの受け付けは Issue #188
 */
const NOTES: { forms: string[]; note: string }[] = [
	// 読み仮名の一覧のうち、意味の分かりにくい言葉
	{ forms: ['役務'], note: '人のためにする仕事やサービスのこと。たとえば、エステや塾、修理など。' },
	{ forms: ['誘引'], note: '人をさそって、引きよせること。景品表示法では、お客を集めることをいう。' },
	{ forms: ['履行'], note: '契約などで約束したことを、そのとおりに実行すること。' },
	{ forms: ['附則'], note: '法律の本体のあとに付く部分。いつから使うかや、前の決まりからの移り方などを書く。' },
	{ forms: ['撤回'], note: '一度した申込みなどを、あとから取りやめること。' },
	{ forms: ['準用'], note: 'ある決まりを、似たほかの場面にも、必要な読みかえをして当てはめること。' },
	{ forms: ['是正'], note: 'よくないところを、正しく直すこと。' },
	{ forms: ['不実'], note: '事実とちがうこと。「不実のことを告げる」は、事実とちがうことを言うこと。' },
	{ forms: ['威迫'], note: 'おどして、相手をこわがらせること。' },
	{ forms: ['課徴金'], note: '決まりを破って得た売上げなどに応じて、国が事業者に払わせるお金。刑罰の罰金とはちがう。' },
	{ forms: ['景品類'], note: 'お客をさそうために、商品などに付けてわたす物やお金、もてなしなど。' },
	{ forms: ['名宛人'], note: '命令や通知などを受ける相手として、名前が書かれている人。' },
	{ forms: ['割賦'], note: '代金を何回かに分けて払うこと。分割払い。' },
	{ forms: ['過料'], note: '決まりを守らなかったときに払わせるお金。刑罰ではないので、前科にはならない。' },
	{ forms: ['併科'], note: '拘禁刑と罰金のように、2つ以上の刑罰をいっしょに科すこと。' },
	{ forms: ['媒介'], note: '二人のあいだに入って、契約がまとまるように手伝うこと。なかだち。' },
	{ forms: ['縦覧'], note: '書類などを、だれでも見られるようにしておくこと。' },
	{ forms: ['追認'], note: 'あとから「それでよい」と認めること。取り消せる契約を追認すると、もう取り消せない。' },
	{ forms: ['承継'], note: '権利や義務を、ほかの人や会社から受けつぐこと。' },
	{ forms: ['承継人'], note: '権利や義務を、ほかの人や会社から受けついだ人。' },
	{ forms: ['弁済'], note: '借りたお金を返すなど、払うべきものを払って、義務を果たすこと。' },
	{ forms: ['送達'], note: '裁判所などが、決まった方法で書類を相手にとどけること。' },
	{ forms: ['拘禁刑'], note: '刑務所などに入れる刑罰。2025年6月に、懲役と禁錮が一つになってできた。' },
	{ forms: ['差止'], note: '悪いことをやめさせたり、始めないようにさせたりすること。' },
	{ forms: ['故意'], note: 'わざとすること。結果が起きるとわかっていて、そうすること。' },
	// 読めても、法律では意味が違う言葉
	{ forms: ['善意'], note: '法律では、ある事実を知らないこと。「よい心」という意味ではない。' },
	{ forms: ['悪意'], note: '法律では、ある事実を知っていること。「悪い心」という意味ではない。' },
	{ forms: ['みなす', 'みなされる', 'みなし'], note: '本当はちがっても、法律の上では同じものとして扱うこと。反対の証明をしても変わらない。' },
	{ forms: ['推定'], note: '反対の証明がなければ、そうだとして扱うこと。証明すれば、くつがえせる。' },
	{ forms: ['取消し', '取り消し', '取り消す'], note: '一度は効力のあるものを、あとからさかのぼって、なかったことにすること。' },
	{ forms: ['無効'], note: 'はじめから効力がないこと。取り消さなくても、効力は生じない。' },
	{ forms: ['政令'], note: '法律を実際に動かすために、内閣が定める決まり。' },
	{ forms: ['内閣府令'], note: '法律や政令を実際に動かすために、内閣総理大臣が定める決まり。' },
	{ forms: ['経過措置'], note: '決まりが変わるときに、前の決まりから新しい決まりへ移るあいだの扱いを定めたもの。' }
];

/** 読み仮名を付けた部分（rt あり）と、そのままの部分 */
export type RubySegment = { text: string; rt?: string };
export type GlossaryEntry = { word: string; parts: RubySegment[] };
type Entry = GlossaryEntry;

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
const NOTE_OF = new Map(NOTES.flatMap((n) => n.forms.map((f) => [f, n.note] as const)));
/** 当てる言葉：読み仮名の一覧の言葉と、説明だけの言葉（読み仮名なし） */
const BY_WORD = new Map<string, Entry>([...NOTE_OF.keys()].map((w) => [w, { word: w, parts: [{ text: w }] }]));
for (const e of ENTRIES) BY_WORD.set(e.word, e);
/** 長い言葉を先に試す（「承継人」を「承継」と「人」に分けない） */
const PATTERN = new RegExp(
	[...BY_WORD.keys()]
		.sort((a, b) => b.length - a.length)
		.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
		.join('|'),
	'g'
);

/** 説明の一覧（Issue #143）。読みは読み仮名の一覧の言葉だけ（ほかは null） */
export function glossaryNotes(): { word: string; reading: string | null; note: string }[] {
	return [...NOTE_OF].map(([word, note]) => {
		const parts = BY_WORD.get(word)!.parts;
		return { word, reading: parts.some((p) => p.rt !== undefined) ? parts.map((p) => p.rt ?? p.text).join('') : null, note };
	});
}

/** 文の切れ。言葉（読み仮名の部分と説明）か、そのままの文 */
export type GlossSegment = { text: string } | { word: string; parts: RubySegment[]; note: string | null };

/** 文を、一覧の言葉とそのままの部分に分ける。そのままの部分は隣どうしをつなげる */
export function glossSegments(text: string): GlossSegment[] {
	const out: GlossSegment[] = [];
	const plain = (t: string) => {
		if (!t) return;
		const last = out[out.length - 1];
		if (last && 'text' in last) last.text += t;
		else out.push({ text: t });
	};
	let at = 0;
	for (const m of text.matchAll(PATTERN)) {
		plain(text.slice(at, m.index));
		const entry = BY_WORD.get(m[0])!;
		const note = NOTE_OF.get(m[0]) ?? null;
		// 読み仮名も説明もない言葉はない（BY_WORD はどちらかを持つ言葉だけ）
		out.push({ word: entry.word, parts: entry.parts.map((p) => ({ ...p })), note });
		at = m.index + m[0].length;
	}
	plain(text.slice(at));
	return out.length ? out : [{ text }];
}

/** 変更点の部分ごとに言葉を当てる（Issue #129 基準6・#143 基準4）。切れ目が言葉の途中にあれば、その言葉には読み仮名も説明も付かない */
export function glossParts<T extends { value: string }>(parts: T[]): (T & { segments: GlossSegment[] })[] {
	return parts.map((p) => ({ ...p, segments: glossSegments(p.value) }));
}

/** 一覧の言葉と読み（写しを返す） */
export function glossaryEntries(): GlossaryEntry[] {
	return ENTRIES.map((e) => ({ word: e.word, parts: e.parts.map((p) => ({ ...p })) }));
}

/** 文を、一覧の言葉に読み仮名を付けた部分に分ける。そのままの部分は隣どうしをつなげる */
export function rubySegments(text: string): RubySegment[] {
	const out: RubySegment[] = [];
	const plain = (t: string) => {
		const last = out[out.length - 1];
		if (last && last.rt === undefined) last.text += t;
		else out.push({ text: t });
	};
	for (const s of glossSegments(text)) {
		if ('text' in s) plain(s.text);
		else for (const p of s.parts) (p.rt === undefined ? plain(p.text) : out.push(p));
	}
	return out;
}

/**
 * 変更点の部分ごとに読み仮名を付ける（基準6）。部分ごとに当てるので、切れ目が言葉の途中にあれば、その言葉には付かない
 */
export function rubyParts<T extends { value: string }>(parts: T[]): (T & { segments: RubySegment[] })[] {
	return parts.map((p) => ({ ...p, segments: rubySegments(p.value) }));
}
