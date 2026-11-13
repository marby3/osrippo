// わたしの記録（Issue #171。SpRecord・PcRecord）。本人だけが読む。得票・順位・票・立場・賛否の傾向は渡さない
import { env } from 'cloudflare:workers';
import { drizzle } from 'drizzle-orm/d1';
import { candidacyEnd, candidacySteps } from '#lib/domain/chairs.ts';
import { sessionAt } from '#lib/domain/session.ts';
import { FIRST_COMMITTEE } from '#lib/server/bill-form.ts';
import { candidacyChecks, committeeNameOf, settleElection } from '#lib/server/chairs.ts';
import { nowOf, sessionsAt } from '#lib/server/client.ts';
import type { BatchDb } from '#lib/server/law.ts';
import { unreadCount } from '#lib/server/notification-page.ts';
import { requireUser } from '#lib/server/require-user.ts';
import { settleOnRead } from '#lib/server/results.ts';
import { adoptedAmendments, chairRoleOf, draftedBills, isMember } from '#lib/server/watashi.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const user = requireUser(event);
	const db = drizzle(env.DB);
	const now = nowOf(event);
	const { session, previous, minutes } = sessionsAt(now);
	// 前の会期の委員長選挙を確定する（委員会のページと同じ。確定の印があれば1回読むだけ）。失敗してもページは出し、次に読まれたときか次の Cron でやり直す
	try {
		await settleElection(db as unknown as BatchDb, FIRST_COMMITTEE, previous, now, Math.random, minutes);
	} catch (e) {
		console.error(e);
	}
	// 自分の法案に、前の会期が終わって結果の行がない法案（集計中）があるときだけ、前の会期の結果を確定して読み直す
	const myBills = async () => {
		const first = await draftedBills(db, user.id, now, minutes);
		if (!first.rows.some((b) => b.stage === 'counting' && b.session === previous.key)) return first;
		await settleOnRead(db as unknown as BatchDb, previous, sessionAt(previous.startsAt - 1, minutes), now, minutes);
		return draftedBills(db, user.id, now, minutes);
	};
	const [unread, member, committee, role, bills, amendments, checks] = await Promise.all([
		unreadCount(db, user.id, now, minutes),
		isMember(db, user.id, session),
		committeeNameOf(db, FIRST_COMMITTEE),
		chairRoleOf(db, user.id, FIRST_COMMITTEE, session),
		myBills(),
		adoptedAmendments(db, user.id),
		candidacyChecks(db, user.id, FIRST_COMMITTEE, session, previous)
	]);
	const end = candidacyEnd(session);
	return {
		name: user.name,
		registeredAt: user.createdAt.getTime(),
		unread,
		// その会期の役（解任されたものも）がある人も所属に数える
		committee: member || role !== null ? committee : null,
		role: role ? { ...role, sessionKey: session.key } : null,
		bills,
		amendments,
		candidacy: {
			session,
			next: sessionAt(session.endsAt, minutes),
			end,
			staff: checks.staff,
			steps: candidacySteps(checks, session, now, user.createdAt.getTime()),
			closed: now >= end
		}
	};
};
