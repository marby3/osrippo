// 法令と版の DB を読む（設計書 docs/spec/8.md の決定1〜3）
import { and, desc, eq, gt, inArray, isNull, lte, max, or } from 'drizzle-orm';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import { alias } from 'drizzle-orm/sqlite-core';
import { articleLabel, BASELINE_DATE, compareNum, type Change } from '../domain/law';
import { laws, lawRevisions, provisions, provisionVersions } from '../db/schema';

// D1（本番）と node:sqlite（テスト）の両方の Drizzle を受ける
export type Db = BaseSQLiteDatabase<'async', any>;

/** 「改正された」に数える change（設計書「change の値」） */
const COUNTED: Change[] = ['added', 'amended', 'unconfirmed'];

/** 現在の版：施行済みのうち seq が最大の版（決定2） */
export async function currentRevision(db: Db, lawId: string) {
	const [row] = await db
		.select()
		.from(lawRevisions)
		.where(and(eq(lawRevisions.lawId, lawId), eq(lawRevisions.branch, 'real'), eq(lawRevisions.status, 'enforced')))
		.orderBy(desc(lawRevisions.seq))
		.limit(1);
	return row;
}

/** 版 R で有効な条・項・号の行（決定1） */
export async function provisionsAt(db: Db, revisionId: string) {
	const [r] = await db.select().from(lawRevisions).where(eq(lawRevisions.id, revisionId));
	if (!r) return [];
	const from = alias(lawRevisions, 'from_revision');
	const to = alias(lawRevisions, 'to_revision');
	return db
		.select({
			id: provisions.id,
			kind: provisions.kind,
			parentId: provisions.parentId,
			num: provisionVersions.num,
			caption: provisionVersions.caption,
			text: provisionVersions.text,
			change: provisionVersions.change,
			unconfirmedOf: provisionVersions.unconfirmedOf
		})
		.from(provisionVersions)
		.innerJoin(provisions, eq(provisions.id, provisionVersions.provisionId))
		.innerJoin(from, eq(from.id, provisionVersions.fromRevisionId))
		.leftJoin(to, eq(to.id, provisionVersions.toRevisionId))
		.where(
			and(
				eq(provisions.lawId, r.lawId),
				eq(from.branch, r.branch),
				lte(from.seq, r.seq),
				or(isNull(to.id), gt(to.seq, r.seq))
			)
		);
}

/** 条・項・号ごとの最後に改正された日（決定3）。改正のないものは入らない */
export async function lastAmendedDates(db: Db, lawId: string): Promise<Map<number, string>> {
	const from = alias(lawRevisions, 'from_revision');
	const rows = await db
		.select({ id: provisionVersions.provisionId, date: max(from.enforcementDate) })
		.from(provisionVersions)
		.innerJoin(provisions, eq(provisions.id, provisionVersions.provisionId))
		.innerJoin(from, eq(from.id, provisionVersions.fromRevisionId))
		.where(and(eq(provisions.lawId, lawId), inArray(provisionVersions.change, COUNTED), eq(from.status, 'enforced')))
		.groupBy(provisionVersions.provisionId);
	return new Map(rows.filter((r) => r.date).map((r) => [r.id, r.date!]));
}

/** 法令ページに出すもの。ない法令なら undefined */
export async function lawPage(db: Db, lawId: string) {
	const [law] = await db.select().from(laws).where(eq(laws.id, lawId));
	const current = law && (await currentRevision(db, lawId));
	if (!law || !current) return undefined;

	const rows = await provisionsAt(db, current.id);
	const amended = await lastAmendedDates(db, lawId);
	const childrenOf = (kind: string, parentId: number) =>
		rows.filter((r) => r.kind === kind && r.parentId === parentId).sort((a, b) => compareNum(a.num, b.num));
	const articles = rows
		.filter((r) => r.kind === 'article')
		.sort((a, b) => compareNum(a.num, b.num))
		.map((a) => ({
			num: a.num,
			label: articleLabel(a.num),
			caption: a.caption ?? '',
			lastAmended: amended.get(a.id) ?? null,
			paragraphs: childrenOf('paragraph', a.id).map((p) => ({
				num: p.num,
				text: p.text ?? '',
				items: childrenOf('item', p.id).map((i) => ({ num: i.num, text: i.text ?? '' }))
			}))
		}));

	const revisions = await db
		.select()
		.from(lawRevisions)
		.where(and(eq(lawRevisions.lawId, lawId), eq(lawRevisions.branch, 'real')))
		.orderBy(desc(lawRevisions.seq));
	// 起点の版（seq 0 で 2017年4月1日以前）は、改正履歴に並べない
	const listed = revisions.filter((r) => !(r.seq === 0 && r.enforcementDate <= BASELINE_DATE));
	const entry = (r: (typeof revisions)[number]) => ({ date: r.enforcementDate, title: r.amendmentLawTitle ?? '' });
	return {
		law: { id: law.id, title: law.title, lawNum: law.lawNum },
		current: { enforcementDate: current.enforcementDate },
		articles,
		enforced: listed.filter((r) => r.status === 'enforced').map(entry),
		scheduled: listed.filter((r) => r.status === 'scheduled').map(entry)
	};
}

/** 日本時間の今日（YYYY-MM-DD） */
export function todayInTokyo(): string {
	return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date());
}
