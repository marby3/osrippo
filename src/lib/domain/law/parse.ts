// e-Gov法令API v2 の法令本文（law_full_text）を、本則の条・項・号に分ける

export type EgovNode = { tag: string; attr?: Record<string, string>; children?: (EgovNode | string)[] };

export type Item = { num: string; text: string };
export type Paragraph = { num: string; text: string; items: Item[] };
export type Article = { num: string; label: string; caption: string; paragraphs: Paragraph[] };

const elements = (node: EgovNode, tag: string) =>
	(node.children ?? []).filter((c): c is EgovNode => typeof c !== 'string' && c.tag === tag);

/** 子孫の文字をつなげる。skip の要素（条名や号名など）は飛ばす。号の細分（イ、ロ、ハ）は改行して見出しのあとを空ける */
function textOf(node: EgovNode | string, skip: string[] = []): string {
	if (typeof node === 'string') return node;
	if (skip.includes(node.tag)) return '';
	const text = (node.children ?? []).map((c) => textOf(c, skip)).join('');
	if (/^Subitem\d+$/.test(node.tag)) return `\n${text}`;
	if (/^Subitem\d+Title$/.test(node.tag)) return `${text}　`;
	return text;
}

/** "6_2" → "第6条の2" */
export function articleLabel(num: string): string {
	const [head, ...branches] = num.split('_');
	return `第${head}条${branches.map((b) => `の${b}`).join('')}`;
}

function parseArticle(node: EgovNode): Article {
	return {
		num: node.attr?.Num ?? '',
		label: articleLabel(node.attr?.Num ?? ''),
		caption: elements(node, 'ArticleCaption').map((c) => textOf(c)).join(''),
		paragraphs: elements(node, 'Paragraph').map((p) => ({
			num: p.attr?.Num ?? '',
			text: elements(p, 'ParagraphSentence').map((s) => textOf(s)).join(''),
			items: elements(p, 'Item').map((i) => ({ num: i.attr?.Num ?? '', text: textOf(i, ['ItemTitle']) }))
		}))
	};
}

/** 本則（MainProvision）の条を、編・章・節をたどって順に取り出す。附則と別表は含めない */
export function parseLaw(lawFullText: EgovNode): Article[] {
	const articles: Article[] = [];
	const walk = (node: EgovNode | string) => {
		if (typeof node === 'string') return;
		if (node.tag === 'Article') return void articles.push(parseArticle(node));
		if (['SupplProvision', 'AppdxTable', 'TOC'].includes(node.tag)) return;
		node.children?.forEach(walk);
	};
	walk(lawFullText);
	return articles;
}

const HEADING_KINDS = { Part: 'part', Chapter: 'chapter', Section: 'section', Subsection: 'subsection', Division: 'division' } as const;

/** 本則の編・章・節・款・目の見出し。articles は直下の条の num（設計書 docs/spec/21.md） */
export type Heading = {
	kind: (typeof HEADING_KINDS)[keyof typeof HEADING_KINDS];
	num: string;
	title: string;
	articles: string[];
	children: Heading[];
};

/** 本則の見出しの木。目次（TOC）は条番号を持たないので読まない。附則と別表も含めない */
export function parseHeadings(lawFullText: EgovNode): Heading[] {
	const walk = (node: EgovNode | string): Heading[] => {
		if (typeof node === 'string' || ['SupplProvision', 'AppdxTable', 'TOC'].includes(node.tag)) return [];
		const kind = HEADING_KINDS[node.tag as keyof typeof HEADING_KINDS];
		if (!kind) return (node.children ?? []).flatMap(walk);
		return [
			{
				kind,
				num: node.attr?.Num ?? '',
				title: elements(node, `${node.tag}Title`).map((t) => textOf(t)).join(''),
				articles: elements(node, 'Article').map((a) => a.attr?.Num ?? ''),
				children: (node.children ?? []).flatMap(walk)
			}
		];
	};
	return walk(lawFullText);
}
