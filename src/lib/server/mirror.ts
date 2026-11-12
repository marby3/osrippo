// 公開ミラーの書き出し（Issue #155。#147 決めること22〜24）。自宅サーバーのバッチが、秘密のトークンを付けて読む。
// 外へ出すのは IF世界の法令の本文だけ（法案、解決策、ユーザー名、投稿の中身は入れない）
import { and, asc, count, eq, lt, lte, sql } from 'drizzle-orm';
import { billChanges, billLaws, billResults, ifImportRuns, ifLaws, ifRevisions, voteReviews } from '../db/schema';
import { compareNum } from '../domain/law';
import { isSessionKey, type MirrorLaw, type MirrorSnapshot } from '../domain/mirror';
import { sessionAt } from '../domain/session';
import { ifArticles, ifBranchOf, ifHeadOf } from './if-world';
import { committeeLawList, type Db } from './law';

const encoder = new TextEncoder();

/** Authorization: Bearer <トークン> が秘密の値と同じか。秘密の値がなければ通さない。長さ以外で早く返さない */
export function tokenMatches(authorization: string | null, secret: string | undefined): boolean {
	if (!secret || !authorization?.startsWith('Bearer ')) return false;
	const given = encoder.encode(authorization.slice('Bearer '.length));
	const expected = encoder.encode(secret);
	if (given.length !== expected.length) return false;
	let diff = 0;
	for (let i = 0; i < given.length; i++) diff |= given[i] ^ expected[i];
	return diff === 0;
}

/**
 * 会期が確定したか（#155 の D）。現実の改正の取り込みは、結果と反映を終えたあとにだけ走るので、取り込みが済んだことで結果と反映が済んだとみる。
 * - 取り込み：その会期より前に取り込んだことのある法令は、すべてその会期も取り込み済み（あとから足した法令は、足す前の会期を待たない）
 * - 確認中の法案がない
 * - 可決して確定した法案が、すべて反映されたか要調整になった（確認中のあとで確定した法案は、次の処理で反映される）
 */
async function settled(db: Db, key: string) {
	const [missing, open, unapplied] = await Promise.all([
		db
			.select({ n: count() })
			.from(ifImportRuns)
			.where(and(lt(ifImportRuns.sessionKey, key), sql`NOT EXISTS (SELECT 1 FROM if_import_runs x WHERE x.law_id = ${ifImportRuns}.law_id AND x.session_key = ${key})`)),
		db
			.select({ n: count() })
			.from(voteReviews)
			.where(and(eq(voteReviews.sessionKey, key), eq(voteReviews.status, 'open'))),
		db
			.select({ n: count() })
			.from(billResults)
			.where(
				and(
					eq(billResults.sessionKey, key),
					eq(billResults.outcome, 'passed'),
					sql`NOT EXISTS (SELECT 1 FROM if_revisions i WHERE i.bill_id = ${billResults}.bill_id AND i.bill_rev = ${billResults}.rev)`,
					sql`NOT EXISTS (SELECT 1 FROM if_laws l WHERE l.bill_id = ${billResults}.bill_id)`,
					sql`NOT EXISTS (SELECT 1 FROM bill_adjustments a WHERE a.bill_id = ${billResults}.bill_id AND a.session_key = ${key})`,
					sql`NOT EXISTS (SELECT 1 FROM vote_reviews v WHERE v.bill_id = ${billResults}.bill_id AND v.session_key = ${key} AND v.status = 'voided')`
				)
			)
	]);
	return missing[0].n + open[0].n + unapplied[0].n === 0;
}

/**
 * 書き出せる会期（古い順）。取り込みの記録のある会期を古い順に見て、確定していない会期で止める（あとの会期を先に書き出すと、
 * 前の会期のコミットを後から足せない）。after を渡すとそれより後だけ
 */
export async function mirrorSessions(db: Db, now: number, after: string | null): Promise<string[]> {
	const keys = (await db.selectDistinct({ key: ifImportRuns.sessionKey }).from(ifImportRuns).orderBy(asc(ifImportRuns.sessionKey))).map((r) => r.key).filter(isSessionKey);
	const out: string[] = [];
	for (const key of keys) {
		if (now < sessionAt(Date.parse(`${key}-01T00:00:00+09:00`), null).endsAt) break;
		if (!(await settled(db, key))) break;
		if (after === null || key > after) out.push(key);
	}
	return out;
}

/** 確定した会期の、その会期の処理を終えた時点の IF世界の法令（#155 の A・E）。確定していなければ undefined */
export async function mirrorSession(db: Db, key: string, now: number): Promise<MirrorSnapshot | undefined> {
	if (!isSessionKey(key) || !(await mirrorSessions(db, now, null)).includes(key)) return undefined;
	const out: MirrorLaw[] = [];
	for (const law of await committeeLawList(db)) {
		const repealed = await db
			.select({ id: ifRevisions.billId })
			.from(ifRevisions)
			.innerJoin(billLaws, and(eq(billLaws.billId, ifRevisions.billId), eq(billLaws.rev, ifRevisions.billRev), eq(billLaws.seq, ifRevisions.lawSeq)))
			.where(and(eq(ifRevisions.lawId, law.id), eq(billLaws.action, 'repeal'), lte(ifRevisions.sessionKey, key)))
			.limit(1);
		if (repealed.length) continue;
		const branch = await ifBranchOf(db, law.id);
		if (!branch) continue;
		const { seq } = await ifHeadOf(db, law.id);
		const articles = (await ifArticles(db, law.id, branch, seq, key)).map((a) => ({ num: a.num, caption: a.caption, paragraphs: a.paragraphs }));
		out.push({ id: law.id, title: law.title, enacted: false, articles });
	}
	// 制定の新法（新法の条だけ。関連法の条は関連法に重なる。docs/spec/53.md 決めたこと9）
	const enacted = await db.select().from(ifLaws).where(lte(ifLaws.sessionKey, key)).orderBy(asc(ifLaws.billId));
	for (const law of enacted) {
		const rows = await db
			.select({ num: billChanges.num, caption: billChanges.caption, body: billChanges.body })
			.from(billChanges)
			.where(and(eq(billChanges.billId, law.billId), eq(billChanges.rev, law.billRev), eq(billChanges.lawSeq, 0)));
		const articles = rows
			.filter((c) => c.body !== null)
			.sort((a, b) => compareNum(a.num, b.num))
			.map((c) => ({ num: c.num, caption: c.caption ?? '', paragraphs: JSON.parse(c.body as string) }));
		out.push({ id: law.id, title: law.title, enacted: true, articles });
	}
	return { key, laws: out };
}
