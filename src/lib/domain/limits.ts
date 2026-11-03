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
	/** 解決策の投稿（設計書 docs/spec/34.md 決めたこと2） */
	solutionPerAccount: 10,
	solutionPerNewAccount: 3,
	solutionPerIp: 20,
	banLength: DAY
} as const;

export type RefusalKind =
	| 'post-account'
	| 'post-new'
	| 'post-ip'
	| 'support-day'
	| 'support-burst'
	| 'support-ip'
	| 'report-day'
	| 'solution-account'
	| 'solution-new'
	| 'solution-ip'
	| 'reaction-ip';
export type Refusal = { kind: RefusalKind; retryAt?: number };

/** 違反に数えるか。回線ごとの上限は同じ回線の別の人のせいで当たることがあり、登録したばかりの上限は試しているうちに締め出されないよう、数えない */
export const COUNTS_AS_VIOLATION: Record<RefusalKind, boolean> = {
	'post-account': true,
	'post-new': false,
	'post-ip': false,
	'support-day': true,
	'support-burst': true,
	'support-ip': false,
	'report-day': true,
	'solution-account': true,
	'solution-new': false,
	'solution-ip': false,
	'reaction-ip': false
};

type PostCounts = { accountPostTimes: number[]; ipPosts: number; registeredAt: number };

/** 投稿の上限の共通の形：登録したばかり → アカウント → 回線の順 */
function checkPosting(
	c: PostCounts,
	now: number,
	limits: { perNew: number; perAccount: number; perIp: number },
	kinds: { new: RefusalKind; account: RefusalKind; ip: RefusalKind }
): Refusal | null {
	if (now - c.registeredAt < DAY && c.accountPostTimes.length >= limits.perNew) {
		// 次に書けるのは、上限を超えないところまで古い投稿が24時間より前になるときか、登録から24時間たつときの早いほう
		const sorted = [...c.accountPostTimes].sort((a, b) => a - b);
		const retryAt = Math.min(sorted[sorted.length - limits.perNew] + DAY, c.registeredAt + DAY);
		return { kind: kinds.new, retryAt };
	}
	if (c.accountPostTimes.length >= limits.perAccount) return { kind: kinds.account };
	if (c.ipPosts >= limits.perIp) return { kind: kinds.ip };
	return null;
}

/** 課題の投稿。accountPostTimes はそのアカウントの直近24時間の投稿の時刻 */
export const checkPost = (c: PostCounts, now: number) =>
	checkPosting(
		c,
		now,
		{ perNew: LIMITS.postPerNewAccount, perAccount: LIMITS.postPerAccount, perIp: LIMITS.postPerIp },
		{ new: 'post-new', account: 'post-account', ip: 'post-ip' }
	);

/** 解決策の投稿（設計書 docs/spec/34.md 決めたこと2） */
export const checkSolutionPost = (c: PostCounts, now: number) =>
	checkPosting(
		c,
		now,
		{ perNew: LIMITS.solutionPerNewAccount, perAccount: LIMITS.solutionPerAccount, perIp: LIMITS.solutionPerIp },
		{ new: 'solution-new', account: 'solution-account', ip: 'solution-ip' }
	);

/** 「わかる」。selfAddedRecently は、そのアカウントが24時間のうちにこの課題へ付けたことがあるか（どの回線からでも） */
export function checkSupport(
	c: {
		op: 'add' | 'remove';
		accountDay: number;
		accountBurst: number;
		otherAccountsOnIp: number;
		selfAddedRecently: boolean;
	},
	/** 同じ対象に同じ回線から付けすぎたときの種類（課題の「わかる」か、解決策か） */
	ipKind: RefusalKind = 'support-ip'
): Refusal | null {
	if (c.accountDay >= LIMITS.supportPerDay) return { kind: 'support-day' };
	if (c.accountBurst >= LIMITS.supportPerBurst) return { kind: 'support-burst' };
	if (c.op === 'add' && !c.selfAddedRecently && c.otherAccountsOnIp >= LIMITS.supportAccountsPerIp) {
		return { kind: ipKind };
	}
	return null;
}

/** 直近24時間の違反（いまの1回を含む）から、締め出しの期限を決める。締め出さないなら null */
export function banUntil(violationsInDay: number, now: number): number | null {
	return violationsInDay >= LIMITS.violationsToBan ? now + LIMITS.banLength : null;
}
