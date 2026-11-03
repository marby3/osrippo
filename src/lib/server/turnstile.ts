// Turnstile（設計書 docs/spec/25.md 決めたこと8）
type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * Cloudflare の siteverify に問い合わせ、success が真で hostname が自分のホストのときだけ通す。5秒で打ち切る。
 * hostname が null なら比べない（手元。テスト用の鍵の応答は自分のホスト名を返さないため）
 */
export async function verifyTurnstile(
	token: string,
	secret: string,
	ip: string,
	hostname: string | null,
	fetcher: Fetch = fetch
): Promise<boolean> {
	// トークンは2048字まで（Cloudflare の説明）。空や長すぎるものは問い合わせない
	if (!token || token.length > 2048) return false;
	const body = new FormData();
	body.append('secret', secret);
	body.append('response', token);
	body.append('remoteip', ip);
	try {
		const res = await fetcher(SITEVERIFY, { method: 'POST', body, signal: AbortSignal.timeout(5000) });
		if (!res.ok) return false;
		const data = (await res.json()) as { success?: unknown; hostname?: unknown };
		return data.success === true && (hostname === null || data.hostname === hostname);
	} catch {
		return false;
	}
}
