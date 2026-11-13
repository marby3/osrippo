// 招待コード（設計書 docs/spec/199.md）
import { and, desc, eq, isNull } from 'drizzle-orm';
import { invites } from '../db/schema';
import { generateInviteCode } from '../domain/invites';
import type { Db } from './law';

/** 運営がコードを作る。作ったコードを返す */
export async function createInvites(db: Db, createdBy: string, count: number, now: number): Promise<string[]> {
	const codes = Array.from({ length: count }, generateInviteCode);
	await db.insert(invites).values(codes.map((code) => ({ code, createdBy, createdAt: now })));
	return codes;
}

/** 使っていなくて取り消していないコードを、1つの文で使用済みにする。変わった行が1なら true（同時に使っても1人だけ） */
export async function useInvite(db: Db, code: string, now: number): Promise<boolean> {
	const changed = await db
		.update(invites)
		.set({ usedAt: now })
		.where(and(eq(invites.code, code), isNull(invites.usedAt), isNull(invites.revokedAt)))
		.returning({ code: invites.code });
	return changed.length === 1;
}

/** 使用済みにしたコードに、登録した人を書く */
export async function recordInviteUser(db: Db, code: string, userId: string): Promise<void> {
	await db
		.update(invites)
		.set({ usedBy: userId })
		.where(and(eq(invites.code, code), isNull(invites.usedBy)));
}

/** 使っていなくて取り消していないコードを取り消す。変わった行が0なら false */
export async function revokeInvite(db: Db, code: string, now: number): Promise<boolean> {
	const changed = await db
		.update(invites)
		.set({ revokedAt: now })
		.where(and(eq(invites.code, code), isNull(invites.usedAt), isNull(invites.revokedAt)))
		.returning({ code: invites.code });
	return changed.length === 1;
}

/** 運営の画面の一覧（新しい順）。使った人は返さない */
export async function inviteList(db: Db) {
	return db
		.select({ code: invites.code, createdAt: invites.createdAt, usedAt: invites.usedAt, revokedAt: invites.revokedAt })
		.from(invites)
		.orderBy(desc(invites.createdAt), invites.code);
}
