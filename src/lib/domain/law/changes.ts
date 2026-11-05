// 現実の版と版のあいだで変わった条と、IF世界の条とのぶつかりの判定（設計書 docs/spec/95.md の決定B）。DB には触れない
import { articleBodyText, articleText } from './display';
import type { Paragraph } from './parse';

export type ArticleRow = { id: number; num: string; caption: string; paragraphs: Paragraph[] };
export type ArticleChangeKind = 'amended' | 'renumbered' | 'added' | 'removed';

export type ArticleChange = {
	/** 新しい版の条（なくなった条は前の版の条） */
	provisionId: number;
	/** 現実の番号（なくなった条は前の番号） */
	num: string;
	prevNum: string | null;
	change: ArticleChangeKind;
	/** 似ていなくて内部IDが変わった条の、閉じた内部ID */
	closedProvisionId: number | null;
	after: ArticleRow | null;
};

/**
 * 前の版と後の版の条を内部IDで比べる。似ていなくて内部IDが変わった条（unconfirmed。「第5条 削除」もこの形）は、
 * 閉じた条と同じ番号の新しい条を1つの本文の変更にまとめる。変わらない条は返さない
 */
export function changedArticles(before: ArticleRow[], after: ArticleRow[]): ArticleChange[] {
	const beforeById = new Map(before.map((a) => [a.id, a]));
	const afterIds = new Set(after.map((a) => a.id));
	const closedByNum = new Map(before.filter((a) => !afterIds.has(a.id)).map((a) => [a.num, a]));
	const changes: ArticleChange[] = [];
	for (const a of after) {
		const old = beforeById.get(a.id);
		if (old) {
			const moved = old.num !== a.num;
			if (articleText(old) !== articleText(a)) changes.push({ provisionId: a.id, num: a.num, prevNum: moved ? old.num : null, change: 'amended', closedProvisionId: null, after: a });
			else if (moved) changes.push({ provisionId: a.id, num: a.num, prevNum: old.num, change: 'renumbered', closedProvisionId: null, after: a });
			continue;
		}
		const closed = closedByNum.get(a.num);
		if (closed) closedByNum.delete(a.num);
		changes.push({ provisionId: a.id, num: a.num, prevNum: null, change: closed ? 'amended' : 'added', closedProvisionId: closed?.id ?? null, after: a });
	}
	for (const a of closedByNum.values()) changes.push({ provisionId: a.id, num: a.num, prevNum: null, change: 'removed', closedProvisionId: null, after: null });
	return changes;
}

export type IfArticle = ArticleRow & { changedBy: { id: number } | null };
export type Conflict = { realCaption: string | null; realBody: string | null; ifNum: string; ifCaption: string | null; ifBody: string | null; billId: number };

/** IF世界の削除、現実の「削除」の本文、現実でなくなった条は同じ中身 */
const DELETED_TEXT = articleText({ caption: '', paragraphs: [{ num: '1', text: '削除', items: [] }] });

/**
 * ぶつかりの判定。相手は、同じ内部IDの IF世界の条を先に見て、なければ同じ番号の IF世界の別の条。
 * IF世界で変えていない条はぶつからない。中身が同じで番号も同じならぶつからない。ifArticles は IF世界で変えた条だけ
 */
export function conflictOf(change: ArticleChange, ifArticles: IfArticle[]): Conflict | null {
	const byId = (id: number | null) => ifArticles.find((a) => a.id === id);
	const own = byId(change.provisionId) ?? byId(change.closedProvisionId);
	const target = own ?? (change.after ? ifArticles.find((a) => a.num === change.num) : undefined);
	if (!target) return null;
	const realText = change.after ? articleText(change.after) : DELETED_TEXT;
	const ifText = articleText(target);
	const sameNum = change.after === null || target.num === change.num;
	if (realText === ifText && sameNum) return null;
	return {
		realCaption: change.after?.caption ?? null,
		realBody: change.after ? articleBodyText(change.after.paragraphs) : null,
		ifNum: target.num,
		ifCaption: ifText === DELETED_TEXT ? null : target.caption,
		ifBody: ifText === DELETED_TEXT ? null : articleBodyText(target.paragraphs),
		billId: (target.changedBy as { id: number }).id
	};
}
