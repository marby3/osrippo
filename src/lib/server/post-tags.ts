// 発言の役のタグ（Issue #169。#198 の決定2）。委員長と理事は /iinkai で名前を公開しているので、投稿にもタグを付ける。
// 書いた時点の会期（posts.session_key）の、その法案の委員会の chair_terms で決める。書いたあとで解任されても、書いたときの役のまま
import { and, eq, gt, isNull, or, sql } from 'drizzle-orm';
import { bills, chairTerms, committees, posts } from '../db/schema';
import type { ChairTag } from '../domain/post-tags';
import type { Db } from './law';

/** 投稿の番号 → 書いた人が書いた時点で委員長か理事なら、その役。どちらでもない投稿は入らない */
export async function chairTagsOf(db: Db, postIds: readonly number[]): Promise<Map<number, ChairTag>> {
	if (postIds.length === 0) return new Map();
	const rows = await db
		.select({ id: posts.id, role: chairTerms.role, committee: committees.name, sessionKey: chairTerms.sessionKey })
		.from(posts)
		.innerJoin(bills, eq(bills.id, posts.billId))
		.innerJoin(
			chairTerms,
			and(
				eq(chairTerms.committeeId, bills.committeeId),
				eq(chairTerms.sessionKey, posts.sessionKey),
				eq(chairTerms.userId, posts.userId),
				or(isNull(chairTerms.recalledAt), gt(chairTerms.recalledAt, posts.createdAt))
			)
		)
		.innerJoin(committees, eq(committees.id, chairTerms.committeeId))
		// 番号が多くても束ねる値の数の上限に当たらないように、JSON の1つの値で渡す
		.where(sql`${posts.id} IN (SELECT value FROM json_each(${JSON.stringify(postIds)}))`);
	return new Map(rows.map((r) => [r.id, { kind: 'chair' as const, role: r.role, committee: r.committee, sessionKey: r.sessionKey }]));
}
