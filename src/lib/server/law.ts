// 法令と版の DB を読む（設計書 docs/spec/8.md の決定1〜3）
import { and, asc, desc, eq, gt, inArray, isNull, lt, lte, max, or } from 'drizzle-orm';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import { alias } from 'drizzle-orm/sqlite-core';
import { articleLabel, BASELINE_DATE, compareArticles, compareNum, type Change } from '../domain/law';
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
		.where(
			and(
				eq(provisions.lawId, lawId),
				eq(from.branch, 'real'),
				inArray(provisionVersions.change, COUNTED),
				eq(from.status, 'enforced')
			)
		)
		.groupBy(provisionVersions.provisionId);
	return new Map(rows.filter((r) => r.date).map((r) => [r.id, r.date!]));
}

/** 版で有効な行を、条・項・号の木にする（並びは num の順） */
function articlesAt(rows: Awaited<ReturnType<typeof provisionsAt>>) {
	const childrenOf = (kind: string, parentId: number) =>
		rows.filter((r) => r.kind === kind && r.parentId === parentId).sort((a, b) => compareNum(a.num, b.num));
	return rows
		.filter((r) => r.kind === 'article')
		.sort((a, b) => compareNum(a.num, b.num))
		.map((a) => ({
			id: a.id,
			num: a.num,
			label: articleLabel(a.num),
			caption: a.caption ?? '',
			paragraphs: childrenOf('paragraph', a.id).map((p) => ({
				num: p.num,
				text: p.text ?? '',
				items: childrenOf('item', p.id).map((i) => ({ num: i.num, text: i.text ?? '' }))
			}))
		}));
}

/** 法令ページに出すもの。ない法令なら undefined */
export async function lawPage(db: Db, lawId: string) {
	const [law] = await db.select().from(laws).where(eq(laws.id, lawId));
	const current = law && (await currentRevision(db, lawId));
	if (!law || !current) return undefined;

	const amended = await lastAmendedDates(db, lawId);
	// 内部IDは画面に渡さない
	const articles = articlesAt(await provisionsAt(db, current.id)).map(({ id, ...a }) => ({
		...a,
		lastAmended: amended.get(id) ?? null
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

/**
 * 比較ページに出すもの。mae／ato が省かれたら、現在の版とその1つ前を比べる（1つ前がなければ現在の版どうし）。
 * 法令がないか、その法令にない版が指定されたら（片方だけの指定も含む）undefined
 */
export async function comparePage(db: Db, lawId: string, mae?: string | null, ato?: string | null) {
	const [law] = await db.select().from(laws).where(eq(laws.id, lawId));
	if (!law) return undefined;
	const revisions = await db
		.select()
		.from(lawRevisions)
		.where(and(eq(lawRevisions.lawId, lawId), eq(lawRevisions.branch, 'real')))
		.orderBy(asc(lawRevisions.seq));

	let before: (typeof revisions)[number] | undefined, after: (typeof revisions)[number] | undefined;
	if (mae || ato) {
		before = revisions.find((r) => r.id === mae);
		after = revisions.find((r) => r.id === ato);
	} else {
		after = await currentRevision(db, lawId);
		const i = revisions.findIndex((r) => r.id === after?.id);
		before = revisions[Math.max(i - 1, 0)];
	}
	if (!before || !after) return undefined;
	// 前の版に新しいほうが選ばれたら、古い順に入れ替える
	if (before.seq > after.seq) [before, after] = [after, before];

	const changes = compareArticles(
		articlesAt(await provisionsAt(db, before.id)),
		articlesAt(await provisionsAt(db, after.id))
	);

	const option = (r: (typeof revisions)[number]) => ({
		id: r.id,
		date: r.enforcementDate,
		title: r.amendmentLawTitle ?? '',
		scheduled: r.status === 'scheduled'
	});
	return {
		law: { id: law.id, title: law.title },
		revisions: revisions.map(option).reverse(),
		mae: before.id,
		ato: after.id,
		changes
	};
}

/**
 * 条ごとの変わった記録。num は現在の版での条の番号。
 * 改正されたことがない条（または、ない条）なら undefined
 */
export async function articleHistory(db: Db, lawId: string, num: string) {
	const current = await currentRevision(db, lawId);
	if (!current) return undefined;
	const article = (await provisionsAt(db, current.id)).find((r) => r.kind === 'article' && r.num === num);
	if (!article) return undefined;

	const from = alias(lawRevisions, 'from_revision');
	const versions = await db
		.select({
			num: provisionVersions.num,
			change: provisionVersions.change,
			revisionId: from.id,
			seq: from.seq,
			status: from.status,
			date: from.enforcementDate,
			lawNum: from.amendmentLawNum
		})
		.from(provisionVersions)
		.innerJoin(from, eq(from.id, provisionVersions.fromRevisionId))
		.where(eq(provisionVersions.provisionId, article.id))
		.orderBy(desc(from.seq));
	const amendments = versions.filter((v) => COUNTED.includes(v.change) && v.status === 'enforced');
	if (!amendments.length) return undefined;

	// 番号が今と違う時期には、当時の番号を添える
	const then = (n: string) => (n === num ? null : articleLabel(n));
	const baseline = versions.find((v) => v.change === 'baseline');

	// 最新の改正の変更点：その版と、1つ前の版の同じ条を比べる
	const latest = amendments[0];
	const [previous] = await db
		.select()
		.from(lawRevisions)
		.where(and(eq(lawRevisions.lawId, lawId), eq(lawRevisions.branch, 'real'), lt(lawRevisions.seq, latest.seq)))
		.orderBy(desc(lawRevisions.seq))
		.limit(1);
	const at = async (revisionId: string) =>
		articlesAt(await provisionsAt(db, revisionId)).filter((a) => a.id === article.id);
	const [change] = compareArticles(previous ? await at(previous.id) : [], await at(latest.revisionId));

	return {
		label: articleLabel(num),
		latest: change?.parts ?? [],
		amendments: amendments.map((v) => ({ date: v.date, lawNum: v.lawNum ?? '', then: then(v.num) })),
		baseline: baseline ? { then: then(baseline.num) } : null
	};
}

/** 日本時間の今日（YYYY-MM-DD） */
export function todayInTokyo(): string {
	return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date());
}
