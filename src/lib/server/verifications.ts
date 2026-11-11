// 議員・有識者の認証（設計書 docs/spec/157.md）
import { and, asc, desc, eq, gt, inArray, isNull, lte, or, sql, type SQL } from 'drizzle-orm';
import { user, userVerificationLogs, userVerifications } from '../db/schema';
import { isLegislator, verificationExpiry, type Person, type Verified, type VerificationAction, type VerificationInput, type VerificationKind } from '../domain/verification';
import type { BatchDb, Db } from './law';
import { ja } from '../copy/ja';
import { hiddenDuringElection } from './elections';

export type { Person, Verified };

/** 有効な認証の条件 */
export function activeVerification(now: number): SQL {
	return and(isNull(userVerifications.revokedAt), gt(userVerifications.expiresAt, now))!;
}

/** user を読む select に左結合して、有効な認証を足す */
export function verifiedJoin(now: number): SQL {
	return and(eq(userVerifications.userId, user.id), activeVerification(now))!;
}

/** 左結合する表（名前を返す関数が使う） */
export const verifiedTable = userVerifications;

/** select に入れる列（左結合した userVerifications から） */
export function verifiedColumns(now: number) {
	return {
		vKind: userVerifications.kind,
		vName: userVerifications.displayName,
		vField: userVerifications.field,
		// 選挙期間中の議員と立候補した有識者（Issue #151）。認証のない人は左結合が NULL なので偽
		vHidden: hiddenDuringElection(now)
	};
}

/**
 * 列から Person を作る。選挙期間中の議員は、表示名も表示する名前も出さず「議員（…）」にする。
 * 立候補した有識者は、表示名も表示する名前もバッジも出さない（表示名から本人が分かることがある。Issue #151）
 */
export function personOf(row: { name: string; vKind: VerificationKind | null; vName: string | null; vField: string | null; vHidden: number | boolean | null }): Person {
	if (!row.vKind || !row.vName) return { name: row.name, verified: null };
	if (row.vHidden) return row.vKind === 'legislator' ? { name: ja.election.hiddenName, verified: { kind: 'legislator', name: ja.election.hiddenName, field: null, hidden: true } } : { name: ja.election.hiddenPerson, verified: null };
	return { name: row.name, verified: { kind: row.vKind, name: row.vName, field: row.vField } };
}

/** いま議員か（有効な認証の種類が議員。設計書 docs/spec/158.md の 1） */
export async function legislatorAt(db: Db, userId: string, now: number): Promise<boolean> {
	return (await legislatorNameAt(db, userId, now)) !== null;
}

/** いま議員なら表示する名前（氏名）、ちがえば null（ヘッダーの「認証済み・氏名」。docs/spec/149.md の 1） */
export async function legislatorNameAt(db: Db, userId: string, now: number): Promise<string | null> {
	const [row] = await db
		.select({ kind: userVerifications.kind, name: userVerifications.displayName })
		.from(userVerifications)
		.where(and(eq(userVerifications.userId, userId), activeVerification(now)));
	return row && isLegislator(row.kind) ? row.name : null;
}

/** その時点で有効な議員の認証がある人（今月の参加者から除く。設計書 docs/spec/158.md の 5） */
export function legislatorIds(now: number) {
	return sql`SELECT ${userVerifications.userId} FROM ${userVerifications} WHERE ${userVerifications.kind} = 'legislator' AND ${activeVerification(now)}`;
}

/** いま有識者か（有効な認証の種類が有識者）。立候補した選挙の期間中は 'stopped'（解説を書けない。Issue #151・#152） */
export async function expertStateAt(db: Db, userId: string, now: number): Promise<'expert' | 'stopped' | null> {
	const [row] = await db
		.select({ kind: userVerifications.kind, hidden: hiddenDuringElection(now) })
		.from(userVerifications)
		.where(and(eq(userVerifications.userId, userId), activeVerification(now)));
	if (!row || row.kind !== 'expert') return null;
	return row.hidden ? 'stopped' : 'expert';
}

/** 投稿を書いた人のうち、有効な認証のある人だけ（user_id → 表示する名前とバッジ）。投稿の user_id は画面に渡さない */
export async function verifiedAuthors(db: Db, userIds: string[], now: number): Promise<Map<string, Verified>> {
	const ids = [...new Set(userIds)];
	if (!ids.length) return new Map();
	const rows = await db
		.select({ userId: userVerifications.userId, kind: userVerifications.kind, name: userVerifications.displayName, field: userVerifications.field, hidden: hiddenDuringElection(now) })
		.from(userVerifications)
		.where(and(inArray(userVerifications.userId, ids), activeVerification(now)));
	// 選挙期間中の議員は名前を出さず、立候補した有識者は認証のない人と同じく名前を出さない（Issue #151）
	const shown = new Map<string, Verified>();
	for (const r of rows) {
		if (!r.hidden) shown.set(r.userId, { kind: r.kind, name: r.name, field: r.field });
		else if (r.kind === 'legislator') shown.set(r.userId, { kind: 'legislator', name: ja.election.hiddenName, field: null, hidden: true });
	}
	return shown;
}

/** 記録の行を、今回の操作の印の行から作る（書けなかったときは何も入らない） */
function logFromOp(db: Db, action: VerificationAction, actorId: string, now: number, op: string) {
	// D1 の batch には db.run を入れない（本物の D1 でだけ落ちる）。insert … select にする
	return db.insert(userVerificationLogs).select(sql`SELECT NULL, user_id, ${action}, kind, display_name, field, ${actorId}, ${now} FROM user_verifications WHERE op = ${op}`);
}

/** batch の最初の文（returning 付きの書き込み）が行を返したか。印をあとで読むと、別の操作に上書きされて取り違える */
const firstWrote = (results: unknown) => ((results as unknown[][])[0] ?? []).length > 0;

/**
 * 認証を付ける書き込み。有効な認証がないときだけ行を書き（取り消しや期限切れのあとは上書きして付け直す）、
 * 書けたときだけ記録を入れる。2人が同じミリ秒に付けても、有効な認証と記録は1つずつ。書けたかを返す
 */
export async function writeGrant(db: BatchDb, target: VerificationInput & { userId: string }, actorId: string, now: number, op: string = crypto.randomUUID()): Promise<boolean> {
	const values = {
		kind: target.kind,
		displayName: target.name,
		field: target.field,
		grantedAt: now,
		expiresAt: verificationExpiry(now),
		revokedAt: null,
		updatedAt: now,
		op
	};
	const results = await db.batch([
		db
			.insert(userVerifications)
			.values({ userId: target.userId, ...values })
			.onConflictDoUpdate({
				target: userVerifications.userId,
				set: values,
				where: or(sql`${userVerifications.revokedAt} IS NOT NULL`, lte(userVerifications.expiresAt, now))
			})
			.returning({ userId: userVerifications.userId }),
		logFromOp(db, 'grant', actorId, now, op)
	] as never);
	return firstWrote(results);
}

export type GrantError = 'noUser' | 'staff' | 'active';

/** 表示名で利用者を選んで付ける */
export async function grantVerification(
	db: BatchDb,
	input: VerificationInput & { target: string },
	actorId: string,
	now: number
): Promise<{ ok: true } | { ok: false; error: GrantError }> {
	const [target] = await db.select({ id: user.id, role: user.role }).from(user).where(eq(user.name, input.target));
	if (!target) return { ok: false, error: 'noUser' };
	if (target.role !== null) return { ok: false, error: 'staff' };
	const [active] = await db.select({ userId: userVerifications.userId }).from(userVerifications).where(and(eq(userVerifications.userId, target.id), activeVerification(now)));
	if (active) return { ok: false, error: 'active' };
	// 確かめたあとで別の運営が付けたときは、書けないので「すでに認証があります」
	const ok = await writeGrant(db, { userId: target.id, kind: input.kind, name: input.name, field: input.field }, actorId, now);
	return ok ? { ok: true } : { ok: false, error: 'active' };
}

/** 1年延ばす・取り消す。有効な認証にだけ効く。効いたかを返す */
export async function changeVerification(db: BatchDb, action: 'renew' | 'revoke', userId: string, actorId: string, now: number): Promise<boolean> {
	const op = crypto.randomUUID();
	const set = action === 'renew' ? { expiresAt: verificationExpiry(now), updatedAt: now, op } : { revokedAt: now, updatedAt: now, op };
	const results = await db.batch([
		db
			.update(userVerifications)
			.set(set)
			.where(and(eq(userVerifications.userId, userId), activeVerification(now)))
			.returning({ userId: userVerifications.userId }),
		logFromOp(db, action, actorId, now, op)
	] as never);
	return firstWrote(results);
}

/** 運営の画面の一覧：いま有効な認証を、期限の近い順に */
export async function activeVerificationList(db: Db, now: number) {
	return db
		.select({
			userId: userVerifications.userId,
			userName: user.name,
			kind: userVerifications.kind,
			name: userVerifications.displayName,
			field: userVerifications.field,
			expiresAt: userVerifications.expiresAt
		})
		.from(userVerifications)
		.innerJoin(user, eq(user.id, userVerifications.userId))
		.where(activeVerification(now))
		.orderBy(asc(userVerifications.expiresAt), asc(userVerifications.userId));
}

const LOG_PAGE_SIZE = 20;

/** 運営の記録の「認証の記録」（新しい順）。だれが操作したかは返さない */
export async function verificationLogPage(db: Db, page: number, now: number) {
	const rows = await db
		.select({
			id: userVerificationLogs.id,
			action: userVerificationLogs.action,
			kind: userVerificationLogs.kind,
			name: userVerificationLogs.displayName,
			field: userVerificationLogs.field,
			createdAt: userVerificationLogs.createdAt,
			// 選挙期間中の議員と立候補した有識者は、記録でも名前を出さない（Issue #151）
			hidden: hiddenDuringElection(now)
		})
		.from(userVerificationLogs)
		.leftJoin(userVerifications, eq(userVerifications.userId, userVerificationLogs.userId))
		.orderBy(desc(userVerificationLogs.createdAt), desc(userVerificationLogs.id))
		.limit(LOG_PAGE_SIZE + 1)
		.offset((page - 1) * LOG_PAGE_SIZE);
	return {
		rows: rows
			.slice(0, LOG_PAGE_SIZE)
			.map(({ hidden, ...r }) => (hidden ? { ...r, name: r.kind === 'legislator' ? ja.election.hiddenName : ja.election.hiddenPerson, field: null } : r)),
		hasNext: rows.length > LOG_PAGE_SIZE
	};
}
