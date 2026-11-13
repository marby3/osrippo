// β版のお約束への同意（Issue #200）。同意は版ごとに agreements の表へ1行
import { redirect, type RequestEvent } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { agreements } from '../db/schema';
import { AGREEMENT_VERSION } from '../domain/agreement';
import type { Db } from './law';

/** その版に同意した時刻。同意していなければ null */
export async function agreedAt(db: Db, userId: string, version = AGREEMENT_VERSION): Promise<number | null> {
	const [row] = await db
		.select({ agreedAt: agreements.agreedAt })
		.from(agreements)
		.where(and(eq(agreements.userId, userId), eq(agreements.version, version)));
	return row?.agreedAt ?? null;
}

/** 同意を記録する。同じ版にもう一度同意しても、最初の時刻のまま */
export async function recordAgreement(db: Db, userId: string, version: string, now: number): Promise<void> {
	await db.insert(agreements).values({ userId, version, agreedAt: now }).onConflictDoNothing();
}

/** お約束のページへ送る URL。戻り先はいまの画面（フォームの送信では送った画面。?/support などの action の名前は外す） */
export function yakusokuUrl(url: URL): string {
	const params = new URLSearchParams(url.search);
	for (const key of [...params.keys()]) if (key.startsWith('/')) params.delete(key);
	const search = params.size > 0 ? `?${params}` : '';
	return `/yakusoku?next=${encodeURIComponent(url.pathname + search)}`;
}

/** いまの版に同意していなければ、お約束のページへ送る（書き込みの前と、書く画面を開く前） */
export async function requireAgreement(event: Pick<RequestEvent, 'url'>, db: Db, userId: string): Promise<void> {
	if ((await agreedAt(db, userId)) === null) redirect(303, yakusokuUrl(event.url));
}
