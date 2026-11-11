// 「拾った」ステータスのルール（Issue #150。#147 の決めること10〜12）。DB にも画面にも触れない

/** 検討中・質問で取り上げた */
export const HIROTTA_KINDS = ['considering', 'questioned'] as const;
export type HirottaKind = (typeof HIROTTA_KINDS)[number];
export const HIROTTA_ACTIONS = ['add', 'remove'] as const;
export type HirottaAction = (typeof HIROTTA_ACTIONS)[number];

/** 会議録の URL の長さの上限 */
export const KOKKAI_URL_MAX = 500;
const KOKKAI_HOST = 'kokkai.ndl.go.jp';

/** 会議録の番号（例 121205254X00720231120）と発言の番号 */
const KOKKAI_PATH = /^\/txt\/([0-9A-Z]{10,30})(?:\/(\d{1,4}))?$/;

/**
 * 国会会議録検索システムの会議録の URL（/txt/会議録の番号、または /txt/会議録の番号/発言の番号）だけを受け付け、
 * 正規の形と会議録の番号を返す。ほかは null（問い合わせずに断る。任意の URL をサーバーに開かせない）
 */
export function parseKokkaiUrl(raw: string | null | undefined): { url: string; meetingId: string } | null {
	const text = (raw ?? '').trim();
	if (!text || text.length > KOKKAI_URL_MAX) return null;
	let url: URL;
	try {
		url = new URL(text);
	} catch {
		return null;
	}
	if (url.protocol !== 'https:' || url.hostname !== KOKKAI_HOST || url.port !== '' || url.username || url.password) return null;
	const match = KOKKAI_PATH.exec(url.pathname);
	if (!match || url.href.length > KOKKAI_URL_MAX) return null;
	return { url: url.href, meetingId: match[1] };
}
