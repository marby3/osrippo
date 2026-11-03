// 書き込みの前の確かめ（設計書 docs/spec/25.md 決めたこと7〜9・12）：アクセス元の国と IP、Turnstile
import { env } from 'cloudflare:workers';
import { fail, type ActionFailure, type RequestEvent } from '@sveltejs/kit';
import { ja } from '../copy/ja';
import { hashIp } from '../domain/ip';
import type { Refusal } from '../domain/limits';
import { activeBan, type Actor } from './issues';
import type { Db } from './law';
import { verifyTurnstile } from './turnstile';

const isLocalHost = (url: URL) => ['localhost', '127.0.0.1'].includes(url.hostname);

/** 画面のテストのサーバー：TEST_LOGIN が "1" で、要求のホストが手元（docs/spec/23.md 決めたこと10と同じ条件） */
export const isTestServer = (url: URL) => env.TEST_LOGIN === '1' && isLocalHost(url);

/**
 * アクセス元の国と IP。手元では国を JP とし（手元の wrangler は US などにするため）、画面のテストではヘッダーで差し替えられる。
 * 本番は公開のホスト名で届くので、手元の分岐には入らない
 */
export function clientOf(event: Pick<RequestEvent, 'url' | 'request'>): { country: string | null; ip: string | null } {
	const headers = event.request.headers;
	if (isLocalHost(event.url)) {
		const test = isTestServer(event.url);
		return {
			country: (test && headers.get('x-test-country')) || 'JP',
			ip: (test && headers.get('x-test-ip')) || headers.get('cf-connecting-ip') || '127.0.0.1'
		};
	}
	// SvelteKit 3 の adapter は platform を作らず、Worker が受け取った要求をそのまま event.request に渡す。
	// その要求に Cloudflare が付ける request.cf だけを信じる（ヘッダーはクライアントが送れるので使わない）
	const cf = (event.request as Request & { cf?: { country?: string } }).cf;
	return { country: cf?.country ?? null, ip: headers.get('cf-connecting-ip') };
}

/** 日本からのアクセスだけ（Tor の T1、分からないときは断る） */
export const allowedCountry = (country: string | null) => country === 'JP';

export const ipHashOf = (ip: string) => hashIp(env.IP_HASH_SECRET, ip);

/** Turnstile のトークンを確かめる。画面のテストのサーバーでは外部に問い合わせず、test-pass だけを通す */
export function checkTurnstile(event: Pick<RequestEvent, 'url'>, token: string, ip: string): Promise<boolean> {
	if (isTestServer(event.url)) return Promise.resolve(token === 'test-pass');
	return verifyTurnstile(token, env.TURNSTILE_SECRET_KEY, ip, isLocalHost(event.url) ? null : event.url.hostname);
}

/** 断るときの文言（画面には実装用語を出さない） */
export function refusalMessage(refusal: Refusal): string {
	const message = ja.guard.refusals[refusal.kind];
	return typeof message === 'function' ? message(refusal.retryAt ?? Date.now()) : message;
}

/**
 * 課題の投稿と「わかる」の前の確かめ：国 → 締め出し（設計書 決めたこと12）。
 * 通れば書き込む人（IP はハッシュ）を、通らなければ画面に出す失敗を返す
 */
export async function writeGuard(
	event: Pick<RequestEvent, 'url' | 'request'>,
	db: Db,
	user: { id: string; createdAt: Date },
	now: number
): Promise<{ ok: true; actor: Actor; ip: string } | { ok: false; failure: ActionFailure<{ message: string }> }> {
	const { country, ip } = clientOf(event);
	if (!allowedCountry(country) || !ip) return { ok: false, failure: fail(403, { message: ja.guard.outsideJapan }) };
	const until = await activeBan(db, user.id, now);
	if (until !== null) return { ok: false, failure: fail(429, { message: ja.guard.banned(until) }) };
	return { ok: true, ip, actor: { userId: user.id, registeredAt: user.createdAt.getTime(), ipHash: await ipHashOf(ip) } };
}
