// 委員会のページ（Issue #77。設計書 docs/spec/77.md 決めたこと7・8）。ログインなしで読める。確かめの順：ログイン → 国 → 締め出し → 登録から7日 → Turnstile → 入力 → 期間 → 資格。
// 取り下げと署名の取り消しは、ログイン → 国だけ（締め出された人も取り下げられる）
import { fail, redirect, type RequestEvent } from '@sveltejs/kit';
import { env } from 'cloudflare:workers';
import { drizzle } from 'drizzle-orm/d1';
import { ja } from '#lib/copy/ja.ts';
import { candidacyEnd, candidacyOpen, electionOpen } from '#lib/domain/chairs.ts';
import { parseIssueId } from '#lib/domain/issues.ts';
import { billWaitUntil } from '#lib/domain/limits.ts';
import { FIRST_COMMITTEE } from '#lib/server/bill-form.ts';
import {
	cancelRecallSignature,
	castChairVote,
	chairPanelOf,
	committeeNameOf,
	electionPage,
	recallBlock,
	recallStateOf,
	settleElection,
	signRecall,
	staffRoleOf,
	standBlock,
	standForChair,
	voteBlock,
	withdrawCandidacy
} from '#lib/server/chairs.ts';
import { allowedCountry, checkTurnstile, clientOf, ipHashOf, nowOf, refusalMessage, sessionsAt, writeGuard } from '#lib/server/client.ts';
import type { BatchDb } from '#lib/server/law.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const db = drizzle(env.DB);
	const now = nowOf(event);
	const { session, previous, minutes } = sessionsAt(now);
	// 前の会期の選挙を確定する。失敗してもページは出し、次に読まれたときか次の Cron でやり直す
	try {
		await settleElection(db as unknown as BatchDb, FIRST_COMMITTEE, previous, now, Math.random, minutes);
	} catch (e) {
		console.error(e);
	}
	const userId = event.locals.user?.id ?? null;
	const panel = await chairPanelOf(db, FIRST_COMMITTEE, session, now);
	const [name, election, recall] = await Promise.all([
		committeeNameOf(db, FIRST_COMMITTEE),
		electionPage(db, FIRST_COMMITTEE, session, userId, Math.random),
		panel.chair ? recallStateOf(db, FIRST_COMMITTEE, session, previous, userId, now) : null
	]);
	const blocks =
		userId === null
			? null
			: {
					stand: candidacyOpen(session, now) ? await standBlock(db, userId, FIRST_COMMITTEE, session, previous) : null,
					vote: electionOpen(session, now) ? await voteBlock(db, userId, session) : null,
					recall: recall?.open ? await recallBlock(db, userId, FIRST_COMMITTEE, session) : null
				};
	return {
		name,
		panel,
		election: {
			...election,
			voteAt: session.voteAt,
			candidacyEnd: candidacyEnd(session),
			endsAt: session.endsAt,
			candidacyOpen: candidacyOpen(session, now),
			open: electionOpen(session, now)
		},
		recall,
		blocks,
		manage: userId !== null && (await staffRoleOf(db, userId, now, minutes)) !== null,
		loggedIn: userId !== null,
		siteKey: env.TURNSTILE_SITE_KEY
	};
};

const LOGIN = `/login?next=${encodeURIComponent('/iinkai')}`;

/** 立候補、投票、署名の確かめ */
async function writer(event: RequestEvent, form: FormData, now: number) {
	const user = event.locals.user;
	if (!user) redirect(303, LOGIN);
	const db = drizzle(env.DB);
	const guard = await writeGuard(event, db, user, now);
	if (!guard.ok) return { failure: guard.failure };
	const wait = billWaitUntil(guard.actor.registeredAt, now);
	if (wait !== null) return { failure: fail(403, { message: ja.chair.tooNew(wait) }) };
	if (!(await checkTurnstile(event, String(form.get('cf-turnstile-response') ?? ''), guard.ip))) return { failure: fail(400, { message: ja.guard.turnstileFailed }) };
	return { db, actor: guard.actor };
}

/** 取り下げと署名の取り消しの確かめ：ログインと国だけ */
async function undoer(event: RequestEvent) {
	const user = event.locals.user;
	if (!user) redirect(303, LOGIN);
	const { country, ip } = clientOf(event);
	if (!allowedCountry(country) || !ip) return { failure: fail(403, { message: ja.guard.outsideJapan }) };
	return { db: drizzle(env.DB), actor: { userId: user.id, registeredAt: user.createdAt.getTime(), ipHash: await ipHashOf(ip) } };
}

const STATUS = { closed: 409, noCandidate: 409, staff: 403, consecutive: 403, noPost: 403, ineligible: 403, forbidden: 403 } as const;

/** 断る理由から画面の失敗を作る */
const refused = (reason: keyof typeof STATUS) => fail(STATUS[reason], { message: ja.chair.blocks[reason] });

export const actions: Actions = {
	stand: async (event) => {
		const now = nowOf(event);
		const checked = await writer(event, await event.request.formData(), now);
		if (checked.failure) return checked.failure;
		const { session, previous } = sessionsAt(now);
		const result = await standForChair(checked.db, checked.actor, FIRST_COMMITTEE, session, previous, now);
		return result.ok ? { stood: true } : refused(result.reason);
	},
	withdraw: async (event) => {
		const now = nowOf(event);
		const checked = await undoer(event);
		if (checked.failure) return checked.failure;
		const done = await withdrawCandidacy(checked.db as unknown as BatchDb, checked.actor, FIRST_COMMITTEE, sessionsAt(now).session, now);
		return done ? { withdrawn: true } : refused('closed');
	},
	vote: async (event) => {
		const now = nowOf(event);
		const form = await event.request.formData();
		const checked = await writer(event, form, now);
		if (checked.failure) return checked.failure;
		const candidate = parseIssueId(String(form.get('candidate') ?? ''));
		if (candidate === null) return fail(400, { message: ja.chair.invalid });
		const result = await castChairVote(checked.db, checked.actor, FIRST_COMMITTEE, sessionsAt(now).session, candidate, now);
		if (result.ok) return { voted: true };
		return 'refusal' in result ? fail(429, { message: refusalMessage(result.refusal) }) : refused(result.reason);
	},
	recall: async (event) => {
		const now = nowOf(event);
		const checked = await writer(event, await event.request.formData(), now);
		if (checked.failure) return checked.failure;
		const { session, previous } = sessionsAt(now);
		const result = await signRecall(checked.db as unknown as BatchDb, checked.actor, FIRST_COMMITTEE, session, previous, now);
		if (result.ok) return { signed: true };
		if ('refusal' in result) return fail(429, { message: refusalMessage(result.refusal) });
		return result.reason === 'ineligible' ? fail(403, { message: ja.chair.blocks.recallIneligible }) : refused(result.reason);
	},
	cancelRecall: async (event) => {
		const now = nowOf(event);
		const checked = await undoer(event);
		if (checked.failure) return checked.failure;
		const done = await cancelRecallSignature(checked.db, checked.actor, FIRST_COMMITTEE, sessionsAt(now).session);
		return done ? { canceled: true } : refused('closed');
	}
};
