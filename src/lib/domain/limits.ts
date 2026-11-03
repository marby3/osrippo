// レート制限と締め出しの判定（設計書 docs/spec/25.md 決めたこと10・11）。時刻は引数で受け取る

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

export const LIMITS = {
	/** 課題の投稿：1アカウント24時間 */
	postPerAccount: 5,
	/** 登録から24時間のアカウント（Tailnet Lock の考え方） */
	postPerNewAccount: 1,
	/** 課題の投稿：1回線24時間 */
	postPerIp: 20,
	/** 「わかる」：1アカウント24時間（付けるのも外すのも1回） */
	supportPerDay: 50,
	/** 「わかる」：1アカウント5分 */
	supportPerBurst: 10,
	burstWindow: 5 * MINUTE,
	/** 同じ課題に同じ回線から付けられるアカウントの数（24時間） */
	supportAccountsPerIp: 3,
	/** 24時間にこの回数の違反で締め出す（fail2ban の考え方） */
	violationsToBan: 3,
	/** 通報：1アカウント24時間（設計書 docs/spec/28.md 決めたこと2） */
	reportPerDay: 10,
	banLength: DAY
} as const;

export type RefusalKind =
	| 'post-account'
	| 'post-new'
	| 'post-ip'
	| 'support-day'
	| 'support-burst'
	| 'support-ip'
	| 'report-day';
export type Refusal = { kind: RefusalKind; retryAt?: number };

/** 違反に数えるか。回線ごとの上限は同じ回線の別の人のせいで当たることがあり、登録したばかりの上限は試しているうちに締め出されないよう、数えない */
export const COUNTS_AS_VIOLATION: Record<RefusalKind, boolean> = {
	'post-account': true,
	'post-new': false,
	'post-ip': false,
	'support-day': true,
	'support-burst': true,
	'support-ip': false,
	'report-day': true
};

/** 課題の投稿。accountPostTimes はそのアカウントの直近24時間の投稿の時刻 */
export function checkPost(
	c: { accountPostTimes: number[]; ipPosts: number; registeredAt: number },
	now: number
): Refusal | null {
	if (now - c.registeredAt < DAY && c.accountPostTimes.length >= LIMITS.postPerNewAccount) {
		// 次に書けるのは、いちばん古い投稿が24時間より前になるときか、登録から24時間たつときの早いほう
		const retryAt = Math.min(Math.min(...c.accountPostTimes) + DAY, c.registeredAt + DAY);
		return { kind: 'post-new', retryAt };
	}
	if (c.accountPostTimes.length >= LIMITS.postPerAccount) return { kind: 'post-account' };
	if (c.ipPosts >= LIMITS.postPerIp) return { kind: 'post-ip' };
	return null;
}

/** 「わかる」。selfAddedRecently は、そのアカウントが24時間のうちにこの課題へ付けたことがあるか（どの回線からでも） */
export function checkSupport(c: {
	op: 'add' | 'remove';
	accountDay: number;
	accountBurst: number;
	otherAccountsOnIp: number;
	selfAddedRecently: boolean;
}): Refusal | null {
	if (c.accountDay >= LIMITS.supportPerDay) return { kind: 'support-day' };
	if (c.accountBurst >= LIMITS.supportPerBurst) return { kind: 'support-burst' };
	if (c.op === 'add' && !c.selfAddedRecently && c.otherAccountsOnIp >= LIMITS.supportAccountsPerIp) {
		return { kind: 'support-ip' };
	}
	return null;
}

/** 直近24時間の違反（いまの1回を含む）から、締め出しの期限を決める。締め出さないなら null */
export function banUntil(violationsInDay: number, now: number): number | null {
	return violationsInDay >= LIMITS.violationsToBan ? now + LIMITS.banLength : null;
}
