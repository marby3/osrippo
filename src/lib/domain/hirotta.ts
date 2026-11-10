// 「拾った」ステータスのルール（Issue #150。#147 の決めること10〜12）。DB にも画面にも触れない

/** 検討中・質問で取り上げた */
export const HIROTTA_KINDS = ['considering', 'questioned'] as const;
export type HirottaKind = (typeof HIROTTA_KINDS)[number];
export const HIROTTA_ACTIONS = ['add', 'remove'] as const;
export type HirottaAction = (typeof HIROTTA_ACTIONS)[number];

/** 会議録の URL の長さの上限 */
export const KOKKAI_URL_MAX = 500;
const KOKKAI_HOST = 'kokkai.ndl.go.jp';

/**
 * 国会会議録検索システムの https の URL だけを受け付け、正規の形で返す。ほかは null（開かずに断る。任意の URL をサーバーに開かせない）
 */
export function parseKokkaiUrl(raw: string | null | undefined): string | null {
	const text = (raw ?? '').trim();
	if (!text || text.length > KOKKAI_URL_MAX) return null;
	let url: URL;
	try {
		url = new URL(text);
	} catch {
		return null;
	}
	if (url.protocol !== 'https:' || url.hostname !== KOKKAI_HOST || url.port !== '' || url.username || url.password) return null;
	return url.href.length > KOKKAI_URL_MAX ? null : url.href;
}

/** テストのサーバーでは会議録のサイトに問い合わせず、この形の URL だけを「ある」とする */
export const testKokkaiExists = (url: string) => url.startsWith(`https://${KOKKAI_HOST}/txt/test-`);
