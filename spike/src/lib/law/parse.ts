// e-Gov法令API v2 の law_data（response_format=json）を、条・項・号の単位に分ける。
// Spike用：フェーズ1で作り直す前提で、APIの形を確かめるための最小限の実装。

export type XmlNode = { tag: string; attr: Record<string, string>; children: (XmlNode | string)[] };

export type Unit = {
	/** 条の中での位置。p1 = 第1項、p1/i3 = 第1項第3号、p1/i3/s1-2 = その中のロ */
	path: string;
	/** 画面に出す見出し（"２"、"三"、"ロ" など）。第1項は空 */
	label: string;
	text: string;
};

export type ProvisionKind = 'article' | 'suppl' | 'appdx';

export type Provision = {
	/** 版をまたいで同じ条を探すための鍵。条番号そのもの（繰り下げがあるとずれる） */
	key: string;
	kind: ProvisionKind;
	/** APIの Num 属性（"8_2" = 第八条の二、"170:174" = 第百七十条から第百七十四条まで） */
	num: string;
	title: string;
	caption: string;
	deleted: boolean;
	units: Unit[];
};

export type ParsedLaw = {
	lawId: string;
	revisionId: string;
	title: string;
	enforcementDate: string;
	provisions: Provision[];
};

const SUBITEM = /^Subitem(\d+)$/;

function isNode(n: XmlNode | string): n is XmlNode {
	return typeof n !== 'string';
}

/** ルビは本文だけ残し、段（Column）は全角空白でつなぐ */
export function textOf(n: XmlNode | string): string {
	if (!isNode(n)) return n;
	if (n.tag === 'Rt') return '';
	return n.children.map(textOf).join('');
}

function child(n: XmlNode, tag: string): XmlNode | undefined {
	return n.children.find((c): c is XmlNode => isNode(c) && c.tag === tag);
}

function sentenceText(n: XmlNode | undefined): string {
	if (!n) return '';
	const cols = n.children.filter(isNode);
	// 号の「行為　誤認」のような段は全角空白で区切る
	if (cols.length && cols.every((c) => c.tag === 'Column')) return cols.map(textOf).join('　');
	return cols.map(textOf).join('');
}

function walkUnits(n: XmlNode, prefix: string, out: Unit[]) {
	for (const c of n.children) {
		if (!isNode(c)) continue;
		if (c.tag === 'Paragraph') {
			const path = `${prefix}p${c.attr.Num}`;
			out.push({ path, label: textOf(child(c, 'ParagraphNum') ?? c).trim(), text: sentenceText(child(c, 'ParagraphSentence')) });
			walkUnits(c, `${path}/`, out);
		} else if (c.tag === 'Item') {
			const path = `${prefix}i${c.attr.Num}`;
			out.push({ path, label: textOf(child(c, 'ItemTitle') ?? c), text: sentenceText(child(c, 'ItemSentence')) });
			walkUnits(c, `${path}/`, out);
		} else if (SUBITEM.test(c.tag)) {
			const lv = c.tag.match(SUBITEM)![1];
			const path = `${prefix}s${lv}-${c.attr.Num}`;
			out.push({ path, label: textOf(child(c, `${c.tag}Title`) ?? c), text: sentenceText(child(c, `${c.tag}Sentence`)) });
			walkUnits(c, `${path}/`, out);
		} else if (c.tag === 'TableStruct' || c.tag === 'Table') {
			// 表は行ごとに1単位にする（附則・別表の中の表）
			const rows = collect(c, 'TableRow');
			rows.forEach((r, i) => out.push({ path: `${prefix}t${i + 1}`, label: '', text: r.children.filter(isNode).map(textOf).join('｜') }));
		} else if (c.tag === 'Article') {
			// 附則の中の条
			const path = `${prefix}a${c.attr.Num}`;
			out.push({ path, label: textOf(child(c, 'ArticleTitle') ?? c), text: '' });
			walkUnits(c, `${path}/`, out);
		}
	}
}

function collect(n: XmlNode, tag: string, out: XmlNode[] = []): XmlNode[] {
	for (const c of n.children) {
		if (!isNode(c)) continue;
		if (c.tag === tag) out.push(c);
		else collect(c, tag, out);
	}
	return out;
}

function parseArticle(a: XmlNode): Provision {
	const units: Unit[] = [];
	walkUnits(a, '', units);
	const body = units.map((u) => u.text).join('');
	return {
		key: `a${a.attr.Num}`,
		kind: 'article',
		num: a.attr.Num,
		title: textOf(child(a, 'ArticleTitle') ?? a),
		caption: textOf(child(a, 'ArticleCaption') ?? { tag: '', attr: {}, children: [] }),
		deleted: body === '削除' || a.attr.Delete === 'true',
		units
	};
}

export function parseLaw(json: {
	law_info: { law_id: string };
	revision_info: { law_revision_id: string; law_title: string; amendment_enforcement_date: string | null };
	law_full_text: XmlNode;
}): ParsedLaw {
	const provisions: Provision[] = [];
	const root = json.law_full_text;
	const main = collect(root, 'MainProvision')[0];
	for (const a of collect(main, 'Article')) provisions.push(parseArticle(a));
	// 条のない法令（本則が項だけ）もある
	if (!provisions.length) {
		const units: Unit[] = [];
		walkUnits(main, '', units);
		provisions.push({ key: 'main', kind: 'article', num: '', title: '本則', caption: '', deleted: false, units });
	}
	for (const s of collect(root, 'SupplProvision')) {
		const units: Unit[] = [];
		walkUnits(s, '', units);
		const amend = s.attr.AmendLawNum ?? '';
		provisions.push({
			key: `suppl:${amend || 'original'}`,
			kind: 'suppl',
			num: amend,
			title: textOf(child(s, 'SupplProvisionLabel') ?? s) + (amend ? `（${amend}）` : ''),
			caption: '',
			deleted: false,
			units
		});
	}
	for (const t of collect(root, 'AppdxTable')) {
		const title = textOf(child(t, 'AppdxTableTitle') ?? t);
		const units: Unit[] = [];
		walkUnits(t, '', units);
		provisions.push({ key: `appdx:${title.replace(/（.*$/, '')}`, kind: 'appdx', num: t.attr.Num ?? '', title, caption: textOf(child(t, 'RelatedArticleNum') ?? t), deleted: false, units });
	}
	return {
		lawId: json.law_info.law_id,
		revisionId: json.revision_info.law_revision_id,
		title: json.revision_info.law_title,
		enforcementDate: json.revision_info.amendment_enforcement_date ?? '',
		provisions
	};
}

/** 範囲削除（Num="170:174"）を1条ずつに展開する。枝番を含む範囲はそのまま残す */
export function expandDeletedRanges(p: Provision[]): Provision[] {
	return p.flatMap((x) => {
		const m = x.kind === 'article' && x.deleted && x.num.match(/^(\d+):(\d+)$/);
		if (!m) return [x];
		const out: Provision[] = [];
		for (let n = Number(m[1]); n <= Number(m[2]); n++) out.push({ ...x, key: `a${n}`, num: String(n), title: `第${n}条` });
		return out;
	});
}
