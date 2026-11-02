// 版の列から、条・項・号の内部IDと版ごとの行を作る（設計書 docs/spec/8.md）。DB には触れない
import { alignArticles, type Match } from './align';
import type { Article, Item, Paragraph } from './parse';

export type ProvisionKind = 'article' | 'paragraph' | 'item';
export type Change = 'baseline' | 'added' | 'amended' | 'renumbered' | 'unconfirmed';

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

/**
 * revisions は古い順。先頭が起点の版なら hasBaseline を true にする（その行は baseline、そうでなければ added）。
 * 内部IDは nextId から順に振る。
 */
export function buildHistory(
	revisions: { id: string; articles: Article[] }[],
	opts: { hasBaseline: boolean; nextId: number }
) {
	let nextId = opts.nextId;
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

	const [first, ...rest] = revisions;
	if (first) for (const a of first.articles) create(a, 0, null, first.id, opts.hasBaseline ? 'baseline' : 'added', null);
	let prev = first;
	for (const revision of rest) {
		const matches = alignArticles(prev.articles, revision.articles).map(
			(m): ChildMatch => ({ ...m, children: m.paragraphs.map((p): ChildMatch => ({ ...p, children: p.items })) })
		);
		apply(matches, prev.articles, 0, null, revision.id);
		prev = revision;
	}
	return { provisions, versions, nextId };
}
