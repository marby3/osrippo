// 版の列から、条・項・号の内部IDと版ごとの行を作る（設計書 docs/spec/8.md）。DB には触れない
import { alignArticles, type Match } from './align';
import { compareNum } from './display';
import { articleLabel, type Article, type Item, type Paragraph } from './parse';

export type ProvisionKind = 'article' | 'paragraph' | 'item';
export const CHANGES = ['baseline', 'added', 'amended', 'renumbered', 'unconfirmed'] as const;
export type Change = (typeof CHANGES)[number];

export type ProvisionRow = { id: number; kind: ProvisionKind; parentId: number | null };
export type VersionRow = {
	provisionId: number;
	fromRevisionId: string;
	toRevisionId: string | null;
	num: string;
	caption: string | null;
	text: string | null;
	change: Change;
	similarity: number | null;
	unconfirmedOf: number | null;
};

type Node = Article | Paragraph | Item;
type ChildMatch = Match<Node> & { children?: ChildMatch[] };

const kindOf = (depth: number): ProvisionKind => (['article', 'paragraph', 'item'] as const)[depth];
const childrenOf = (node: Node): Node[] =>
	'paragraphs' in node ? node.paragraphs : 'items' in node ? node.items : [];

type Revision = { id: string; articles: Article[] };

/** 版の列を順に当てて、内部IDと行を作る本体。buildHistory と extendHistory で共有する */
function historyWriter(firstId: number) {
	let nextId = firstId;
	const provisions: ProvisionRow[] = [];
	const versions: VersionRow[] = [];
	const idOf = new Map<Node, number>();
	const openRow = new Map<number, VersionRow>();
	const childIds = new Map<number, number[]>();

	const open = (id: number, node: Node, revisionId: string, change: Change, similarity: number | null, unconfirmedOf: number | null) => {
		const row: VersionRow = {
			provisionId: id,
			fromRevisionId: revisionId,
			toRevisionId: null,
			num: node.num,
			caption: 'caption' in node ? node.caption : null,
			text: 'text' in node ? node.text : null,
			change,
			similarity,
			unconfirmedOf
		};
		const prev = openRow.get(id);
		if (prev) prev.toRevisionId = revisionId;
		openRow.set(id, row);
		versions.push(row);
	};

	/** 行を閉じる。まだ閉じていない子と孫も同じ版で閉じる */
	const close = (id: number, revisionId: string) => {
		const row = openRow.get(id);
		if (row) {
			row.toRevisionId = revisionId;
			openRow.delete(id);
		}
		for (const child of childIds.get(id) ?? []) close(child, revisionId);
	};

	/** 新しい内部IDを振る。子はすべて added */
	const create = (node: Node, depth: number, parentId: number | null, revisionId: string, change: Change, unconfirmedOf: number | null) => {
		const id = nextId++;
		provisions.push({ id, kind: kindOf(depth), parentId });
		if (parentId !== null) childIds.set(parentId, [...(childIds.get(parentId) ?? []), id]);
		idOf.set(node, id);
		open(id, node, revisionId, change, null, unconfirmedOf);
		const childChange = change === 'baseline' ? 'baseline' : 'added';
		for (const child of childrenOf(node)) create(child, depth + 1, id, revisionId, childChange, null);
		return id;
	};

	/** 対応付けの結果を当てる。子に renumbered 以外の変化があったかを返す */
	const apply = (matches: ChildMatch[], before: Node[], depth: number, parentId: number | null, revisionId: string): boolean => {
		let changed = false;
		for (const m of matches) {
			if (m.kind === 'removed') {
				close(idOf.get(m.before!)!, revisionId);
				changed = true;
			} else if (m.kind === 'added' || m.kind === 'unconfirmed') {
				const sameNum = m.kind === 'unconfirmed' ? before.find((b) => b.num === m.after!.num) : undefined;
				create(m.after!, depth, parentId, revisionId, m.kind, sameNum ? idOf.get(sameNum)! : null);
				changed = true;
			} else {
				const id = idOf.get(m.before!)!;
				idOf.set(m.after!, id);
				const childChanged = apply(m.children ?? [], childrenOf(m.before!), depth + 1, id, revisionId);
				// 子をつなげた文字列が偶然同じでも、子が変われば親を amended にする（設計書「親への伝わり方」）
				if (m.kind === 'amended' || childChanged) {
					open(id, m.after!, revisionId, 'amended', m.similarity ?? 1, null);
					changed = true;
				} else if (m.before!.num !== m.after!.num) {
					open(id, m.after!, revisionId, 'renumbered', m.similarity ?? 1, null);
				}
			}
		}
		return changed;
	};

	/** 版を順に当てる */
	const follow = (start: Revision, revisions: Revision[]) => {
		let prev = start;
		for (const revision of revisions) {
			const matches = alignArticles(prev.articles, revision.articles).map(
				(m): ChildMatch => ({ ...m, children: m.paragraphs.map((p): ChildMatch => ({ ...p, children: p.items })) })
			);
			apply(matches, prev.articles, 0, null, revision.id);
			prev = revision;
		}
	};

	/** すでにある内部IDの開いている行を引き継ぐ。あとで閉じたかは戻り値の行の toRevisionId に出る */
	const adopt = (id: number, parentId: number | null, node: Node, revisionId: string) => {
		idOf.set(node, id);
		if (parentId !== null) childIds.set(parentId, [...(childIds.get(parentId) ?? []), id]);
		const row: VersionRow = { provisionId: id, fromRevisionId: revisionId, toRevisionId: null, num: node.num, caption: null, text: null, change: 'baseline', similarity: null, unconfirmedOf: null };
		openRow.set(id, row);
		return row;
	};

	return { create, follow, adopt, provisions, versions, nextId: () => nextId };
}

/**
 * revisions は古い順。先頭が起点の版なら hasBaseline を true にする（その行は baseline、そうでなければ added）。
 * 内部IDは nextId から順に振る。
 */
export function buildHistory(revisions: Revision[], opts: { hasBaseline: boolean; nextId: number }) {
	const writer = historyWriter(opts.nextId);
	const [first, ...rest] = revisions;
	if (first) {
		for (const a of first.articles) writer.create(a, 0, null, first.id, opts.hasBaseline ? 'baseline' : 'added', null);
		writer.follow(first, rest);
	}
	return { provisions: writer.provisions, versions: writer.versions, nextId: writer.nextId() };
}

/** 起点の版で有効な行（DB の provisionsAt の戻りの形） */
export type StartRow = { id: number; kind: ProvisionKind; parentId: number | null; num: string; caption: string | null; text: string | null };

/**
 * 起点の版の行から、後ろの版の内部IDと行を作る（設計書 docs/spec/74.md 決めたこと3）。
 * revisions は古い順。戻り値の closes は、起点の行のうちあとの版で閉じるもの。
 */
export function extendHistory(start: { revisionId: string; rows: StartRow[] }, revisions: Revision[], opts: { nextId: number }) {
	const writer = historyWriter(opts.nextId);
	const adopted: VersionRow[] = [];
	const byNum = (a: StartRow, b: StartRow) => compareNum(a.num, b.num);
	const childRows = (kind: ProvisionKind, parentId: number) => start.rows.filter((r) => r.kind === kind && r.parentId === parentId).sort(byNum);
	const adopt = (row: StartRow, node: Node) => void adopted.push(writer.adopt(row.id, row.parentId, node, start.revisionId));
	const articles = start.rows
		.filter((r) => r.kind === 'article')
		.sort(byNum)
		.map((a) => {
			const article: Article = { num: a.num, label: articleLabel(a.num), caption: a.caption ?? '', paragraphs: [] };
			adopt(a, article);
			for (const p of childRows('paragraph', a.id)) {
				const paragraph: Paragraph = { num: p.num, text: p.text ?? '', items: [] };
				adopt(p, paragraph);
				article.paragraphs.push(paragraph);
				for (const i of childRows('item', p.id)) {
					const item: Item = { num: i.num, text: i.text ?? '' };
					adopt(i, item);
					paragraph.items.push(item);
				}
			}
			return article;
		});
	writer.follow({ id: start.revisionId, articles }, revisions);
	return {
		provisions: writer.provisions,
		versions: writer.versions,
		closes: adopted.flatMap((row) => (row.toRevisionId === null ? [] : [{ provisionId: row.provisionId, toRevisionId: row.toRevisionId }])),
		nextId: writer.nextId()
	};
}
