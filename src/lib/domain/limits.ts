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
	/** 法案の下書きを作る・保存する（Issue #46 決めたこと2）。作る回線ごとの上限は、作るほうだけに掛ける */
	billDraftPerAccount: 3,
	billDraftPerIp: 20,
	billSavePerAccount: 60,
	/** 賛同：1アカウント24時間・5分（付けるのも取り消すのも1回）。同じ法案に同じ回線から（設計書 docs/spec/49.md） */
	billSupportPerDay: 30,
	billSupportPerBurst: 10,
	billSupportAccountsPerIp: 3,
	/** 質疑・答弁・補足（設計書 docs/spec/66.md 決めたこと5）。答弁が多いのは、提出者がまとめて答えるため */
	questionPerDay: 10,
	answerPerDay: 30,
	supplementPerDay: 10,
	billPostPerBurst: 10,
	billPostPerIp: 60,
	/** 評価（設計書 docs/spec/67.md 決めたこと3）。カードごとに2つのボタンがあり、読みながら押すので「わかる」の2倍 */
	evaluationPerDay: 100,
	evaluationPerBurst: 20,
	evaluationAccountsPerIp: 3,
	/** 修正案と、本案より先に採決するための賛同（設計書 docs/spec/68.md 決めたこと14）。賛同は法案の賛同と同じ数 */
	amendmentPerDay: 5,
	amendmentPerIp: 20,
	amendmentSupportPerDay: 30,
	amendmentSupportPerBurst: 10,
	amendmentSupportAccountsPerIp: 3,
	/** 下書きを作る・賛同する・発議するのは、登録からこの長さのアカウントだけ（Issue #41 決めたこと6） */
	billAccountAge: 7 * DAY,
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
	| 'reaction-ip'
	| 'bill-draft-account'
	| 'bill-draft-ip'
	| 'bill-save-account'
	| 'bill-support-day'
	| 'bill-support-burst'
	| 'bill-support-ip'
	| 'question-day'
	| 'answer-day'
	| 'supplement-day'
	| 'bill-post-burst'
	| 'bill-post-ip'
	| 'evaluation-day'
	| 'evaluation-burst'
	| 'evaluation-ip'
	| 'amendment-account'
	| 'amendment-ip'
	| 'amendment-support-day'
	| 'amendment-support-burst'
	| 'amendment-support-ip';
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
	'reaction-ip': false,
	'bill-draft-account': true,
	'bill-draft-ip': false,
	'bill-save-account': true,
	'bill-support-day': true,
	'bill-support-burst': true,
	'bill-support-ip': false,
	'question-day': true,
	'answer-day': true,
	'supplement-day': true,
	'bill-post-burst': true,
	'bill-post-ip': false,
	'evaluation-day': true,
	'evaluation-burst': true,
	'evaluation-ip': false,
	'amendment-account': true,
	'amendment-ip': false,
	'amendment-support-day': true,
	'amendment-support-burst': true,
	'amendment-support-ip': false
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

/** 法案の下書きを作る（Issue #46 決めたこと2）。accountDrafts・ipDrafts は直近24時間に作った数 */
export function checkBillDraft(c: { accountDrafts: number; ipDrafts: number }): Refusal | null {
	if (c.accountDrafts >= LIMITS.billDraftPerAccount) return { kind: 'bill-draft-account' };
	if (c.ipDrafts >= LIMITS.billDraftPerIp) return { kind: 'bill-draft-ip' };
	return null;
}

/** 法案の下書きを保存する。accountSaves は直近24時間に保存した数 */
export const checkBillSave = (c: { accountSaves: number }): Refusal | null =>
	c.accountSaves >= LIMITS.billSavePerAccount ? { kind: 'bill-save-account' } : null;

/** 登録から7日たっていなければ、法案を書けるようになる時刻。たっていれば null */
export function billWaitUntil(registeredAt: number, now: number): number | null {
	const at = registeredAt + LIMITS.billAccountAge;
	return now < at ? at : null;
}

/** 賛同。selfAddedRecently は、そのアカウントが24時間のうちにこの法案へ賛同したことがあるか（どの回線からでも。保存のあとに賛同し直せるように） */
export function checkBillSupport(c: {
	op: 'add' | 'remove';
	accountDay: number;
	accountBurst: number;
	otherAccountsOnIp: number;
	selfAddedRecently: boolean;
}): Refusal | null {
	if (c.accountDay >= LIMITS.billSupportPerDay) return { kind: 'bill-support-day' };
	if (c.accountBurst >= LIMITS.billSupportPerBurst) return { kind: 'bill-support-burst' };
	if (c.op === 'add' && !c.selfAddedRecently && c.otherAccountsOnIp >= LIMITS.billSupportAccountsPerIp) return { kind: 'bill-support-ip' };
	return null;
}

/** 質疑・答弁・補足。accountDay はその種類の、accountBurst と ipDay は3種類を合わせた直近の数 */
export function checkBillPost(kind: 'question' | 'answer' | 'supplement', c: { accountDay: number; accountBurst: number; ipDay: number }): Refusal | null {
	const perDay = { question: LIMITS.questionPerDay, answer: LIMITS.answerPerDay, supplement: LIMITS.supplementPerDay }[kind];
	if (c.accountDay >= perDay) return { kind: `${kind}-day` };
	if (c.accountBurst >= LIMITS.billPostPerBurst) return { kind: 'bill-post-burst' };
	if (c.ipDay >= LIMITS.billPostPerIp) return { kind: 'bill-post-ip' };
	return null;
}

/** 評価。付けるのも取り消すのも1回。取り消しと、24時間のうちに自分が付けたことのある投稿は回線の上限を見ない */
export function checkEvaluation(c: { op: 'add' | 'remove'; accountDay: number; accountBurst: number; otherAccountsOnIp: number; selfAddedRecently: boolean }): Refusal | null {
	if (c.accountDay >= LIMITS.evaluationPerDay) return { kind: 'evaluation-day' };
	if (c.accountBurst >= LIMITS.evaluationPerBurst) return { kind: 'evaluation-burst' };
	if (c.op === 'add' && !c.selfAddedRecently && c.otherAccountsOnIp >= LIMITS.evaluationAccountsPerIp) return { kind: 'evaluation-ip' };
	return null;
}

/** 修正案。更新も合わせて数える */
export function checkAmendment(c: { accountDay: number; ipDay: number }): Refusal | null {
	if (c.accountDay >= LIMITS.amendmentPerDay) return { kind: 'amendment-account' };
	if (c.ipDay >= LIMITS.amendmentPerIp) return { kind: 'amendment-ip' };
	return null;
}

/** 本案より先に採決するための賛同。付けるのも取り消すのも1回 */
export function checkAmendmentSupport(c: { op: 'add' | 'remove'; accountDay: number; accountBurst: number; otherAccountsOnIp: number; selfAddedRecently: boolean }): Refusal | null {
	if (c.accountDay >= LIMITS.amendmentSupportPerDay) return { kind: 'amendment-support-day' };
	if (c.accountBurst >= LIMITS.amendmentSupportPerBurst) return { kind: 'amendment-support-burst' };
	if (c.op === 'add' && !c.selfAddedRecently && c.otherAccountsOnIp >= LIMITS.amendmentSupportAccountsPerIp) return { kind: 'amendment-support-ip' };
	return null;
}
