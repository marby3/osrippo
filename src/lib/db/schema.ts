// 法令と版の DB（設計書 docs/spec/8.md）
import { sql } from 'drizzle-orm';
import { check, foreignKey, index, integer, primaryKey, real, sqliteTable, text, unique, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core';
import { CHANGES } from '../domain/law/history';
import type { Heading } from '../domain/law/parse';
import { REACTIONS } from '../domain/solutions';
import { BILL_KINDS, CHANGE_OPS } from '../domain/bills';
import { POST_KINDS, STANCES, type PostRole } from '../domain/posts';
import { EVALUATION_KINDS } from '../domain/evaluations';
import type { NotificationKind } from '../domain/notifications';
import type { AmendmentStatus } from '../domain/amendments';
import { ADJUSTMENT_REASONS, BILL_OUTCOMES, REVIEW_STATUSES, VOTE_CHOICES } from '../domain/votes';

export const laws = sqliteTable('laws', {
	/** e-Gov の law_id */
	id: text('id').primaryKey(),
	title: text('title').notNull(),
	titleKana: text('title_kana'),
	lawNum: text('law_num').notNull()
});

export const lawRevisions = sqliteTable(
	'law_revisions',
	{
		/** e-Gov の law_revision_id */
		id: text('id').primaryKey(),
		lawId: text('law_id')
			.notNull()
			.references(() => laws.id),
		branch: text('branch', { enum: ['real'] }).notNull(),
		/** 法令とブランチの中での古い順の番号（0から） */
		seq: integer('seq').notNull(),
		enforcementDate: text('enforcement_date').notNull(),
		status: text('status', { enum: ['enforced', 'scheduled'] }).notNull(),
		amendmentLawTitle: text('amendment_law_title'),
		amendmentLawNum: text('amendment_law_num'),
		amendmentPromulgateDate: text('amendment_promulgate_date'),
		/** その版の本則の見出しの木（設計書 docs/spec/21.md）。NULL は見出しなしと同じ */
		headings: text('headings', { mode: 'json' }).$type<Heading[]>()
	},
	(t) => [
		unique().on(t.lawId, t.branch, t.seq),
		check('law_revisions_branch', sql`${t.branch} IN ('real')`),
		check('law_revisions_status', sql`${t.status} IN ('enforced', 'scheduled')`)
	]
);

/** 条・項・号そのもの（内部ID）。画面には出さない */
export const provisions = sqliteTable(
	'provisions',
	{
		id: integer('id').primaryKey(),
		lawId: text('law_id')
			.notNull()
			.references(() => laws.id),
		kind: text('kind', { enum: ['article', 'paragraph', 'item'] }).notNull(),
		/** 項→条、号→項。条は NULL */
		parentId: integer('parent_id')
	},
	(t) => [
		foreignKey({ columns: [t.parentId], foreignColumns: [t.id] }),
		index('provisions_law_id').on(t.lawId),
		check('provisions_kind', sql`${t.kind} IN ('article', 'paragraph', 'item')`)
	]
);

/** 条・項・号の、ある版から次に変わるまでの中身 */
export const provisionVersions = sqliteTable(
	'provision_versions',
	{
		id: integer('id').primaryKey(),
		provisionId: integer('provision_id')
			.notNull()
			.references(() => provisions.id),
		fromRevisionId: text('from_revision_id')
			.notNull()
			.references(() => lawRevisions.id),
		/** より新しい版で変わったかなくなったら、その版。そうでなければ NULL */
		toRevisionId: text('to_revision_id').references(() => lawRevisions.id),
		/** e-Gov の Num 属性（例：条 3_2） */
		num: text('num').notNull(),
		/** 条だけ（見出しのない条は空文字） */
		caption: text('caption'),
		/** 項・号だけ */
		text: text('text'),
		change: text('change', { enum: CHANGES }).notNull(),
		/** amended／renumbered のとき */
		similarity: real('similarity'),
		/** 確認待ちのとき、前の版でその番号だった条・項・号 */
		unconfirmedOf: integer('unconfirmed_of').references(() => provisions.id)
	},
	(t) => [
		unique().on(t.provisionId, t.fromRevisionId),
		// 版 R の条文を引くとき（設計書 決定1）に、版で絞り込む
		index('provision_versions_from').on(t.fromRevisionId),
		index('provision_versions_to').on(t.toRevisionId),
		check('provision_versions_change', sql`${t.change} IN (${sql.raw(CHANGES.map((c) => `'${c}'`).join(', '))})`)
	]
);

// ログイン（設計書 docs/spec/23.md）。Better Auth の4つの表。キーは Better Auth の項目名に合わせる

export const ROLES = ['moderator', 'operator'] as const;
/** 運営の画面の操作をする役職。user.role は ROLES だけで、委員長と理事は chair_terms から求める（docs/spec/77.md 決めたこと4） */
export const STAFF_ROLES = [...ROLES, 'chair', 'director'] as const;

const timestamps = {
	createdAt: integer('created_at', { mode: 'timestamp_ms' })
		.notNull()
		.default(sql`(unixepoch() * 1000)`),
	updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
		.notNull()
		.default(sql`(unixepoch() * 1000)`)
};

export const user = sqliteTable('user', {
	id: text('id').primaryKey(),
	/** 表示名（「参加者」＋6桁。一意） */
	name: text('name').notNull().unique(),
	/** 提供元ごとの架空のメール（{provider}-{accountId}@users.invalid）。画面に出さない */
	email: text('email').notNull().unique(),
	emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
	/** 提供元の画像は保存しない */
	image: text('image'),
	/**
	 * 運営（operator）・運営協力者（moderator）。NULL はふつうの参加者（設計書 docs/spec/28.md）。
	 * 付けるのは wrangler d1 execute の手作業。Better Auth には登録しない（参加者が update-user で書けないように）。
	 * 列には CHECK を付けない（付けると drizzle-kit が表を作り直す）
	 */
	role: text('role', { enum: ROLES }),
	...timestamps
});

export const session = sqliteTable('session', {
	id: text('id').primaryKey(),
	expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
	token: text('token').notNull().unique(),
	ipAddress: text('ip_address'),
	userAgent: text('user_agent'),
	userId: text('user_id')
		.notNull()
		.references(() => user.id, { onDelete: 'cascade' }),
	...timestamps
});

export const account = sqliteTable('account', {
	id: text('id').primaryKey(),
	/** 提供元の利用者ID（ID トークンの sub） */
	accountId: text('account_id').notNull(),
	providerId: text('provider_id').notNull(),
	userId: text('user_id')
		.notNull()
		.references(() => user.id, { onDelete: 'cascade' }),
	// トークン類は Better Auth の都合で列を持つが、値は入れない（withoutTokens）
	accessToken: text('access_token'),
	refreshToken: text('refresh_token'),
	idToken: text('id_token'),
	accessTokenExpiresAt: integer('access_token_expires_at', { mode: 'timestamp_ms' }),
	refreshTokenExpiresAt: integer('refresh_token_expires_at', { mode: 'timestamp_ms' }),
	scope: text('scope'),
	password: text('password'),
	...timestamps
});

export const verification = sqliteTable('verification', {
	id: text('id').primaryKey(),
	identifier: text('identifier').notNull(),
	value: text('value').notNull(),
	expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
	...timestamps
});

// 課題と「わかる」、荒らし対策の記録（設計書 docs/spec/25.md）。
// 時刻はミリ秒の整数。比べたり引いたりするので、Date にせず数のまま扱う

/** お題。「今回のお題」は id が最大の行（会期はフェーズ3で結ぶ） */
export const topics = sqliteTable('topics', {
	id: integer('id').primaryKey(),
	name: text('name').notNull(),
	createdAt: integer('created_at')
		.notNull()
		.default(sql`(unixepoch() * 1000)`)
});

export const ISSUE_STATUSES = ['visible', 'auto_hidden', 'hidden', 'restored', 'merged'] as const;
export const MODERATION_ACTORS = ['auto', ...STAFF_ROLES] as const;
/** 非表示の理由。reports は自動（通報が3件） */
export const HIDE_LOG_REASONS = ['reports', 'attack', 'spam', 'other'] as const;

export const issues = sqliteTable(
	'issues',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		userId: text('user_id')
			.notNull()
			.references(() => user.id),
		title: text('title').notNull(),
		/** 困っている人 */
		affected: text('affected').notNull(),
		/** 具体例 */
		example: text('example').notNull(),
		/** NULL はほかの話題 */
		topicId: integer('topic_id').references(() => topics.id),
		createdAt: integer('created_at').notNull(),
		// 通報と非表示（設計書 docs/spec/28.md）。status を変えると、トリガーが下の status_* の値で moderation_logs に記録を書く。
		// トリガー（issues_status_log）は drizzle/0006_solutions.sql に手で書いたもので（最初は 0004、次に 0005）、drizzle のスナップショットにない。
		// この表を作り直すマイグレーションでは、トリガーも消えるので書き直すこと
		/** restored は運営が表示に戻した課題（表示するが、自動では非表示にしない） */
		status: text('status', { enum: ISSUE_STATUSES }).notNull().default('visible'),
		statusActor: text('status_actor', { enum: MODERATION_ACTORS }),
		/** 対応した人。公開しない */
		statusActorUserId: text('status_actor_user_id'),
		statusReason: text('status_reason', { enum: HIDE_LOG_REASONS }),
		statusNote: text('status_note'),
		statusChangedAt: integer('status_changed_at'),
		/**
		 * 統合先（status が merged のとき。設計書 docs/spec/30.md）。外部キーは付けない
		 * （自分の表への外部キーを足すと drizzle-kit が表を作り直し、トリガーと外部キーの行が消えるおそれがある）
		 */
		mergedInto: integer('merged_into')
	},
	(t) => [index('issues_topic_id').on(t.topicId), index('issues_merged_into').on(t.mergedInto)]
);

export const issueSupports = sqliteTable(
	'issue_supports',
	{
		issueId: integer('issue_id')
			.notNull()
			.references(() => issues.id),
		userId: text('user_id')
			.notNull()
			.references(() => user.id),
		createdAt: integer('created_at').notNull()
	},
	// 最近「わかる」が増えている順で、課題ごとに直近の行を数える
	(t) => [primaryKey({ columns: [t.issueId, t.userId] }), index('issue_supports_issue_created').on(t.issueId, t.createdAt)]
);

/**
 * target_id は、issue_post・support_* では課題の番号、solution_post・reaction_* では解決策の番号（設計書 docs/spec/34.md）、
 * bill_* では法案の番号（docs/spec/45.md。v0.3 で使う種類をまとめて足した）。
 * question_post から vote_cast までは v0.4 で使う種類（docs/spec/65.md。Issue ごとに表を作り直さないようにまとめて足した）
 */
export const ACTION_KINDS = [
	'issue_post',
	'support_add',
	'support_remove',
	'violation',
	'solution_post',
	'reaction_add',
	'reaction_remove',
	'bill_draft',
	'bill_save',
	'bill_support_add',
	'bill_support_remove',
	'bill_propose',
	'question_post',
	'answer_post',
	'supplement_post',
	'stance_set',
	'evaluation_add',
	'evaluation_remove',
	'amendment_post',
	'amendment_accept',
	'amendment_support_add',
	'amendment_support_remove',
	'vote_cast',
	'bill_cosponsor',
	'bill_withdraw'
] as const;

/** レート制限を数えるための記録。IP はハッシュ（ip_hash）だけを持つ */
export const actions = sqliteTable(
	'actions',
	{
		id: integer('id').primaryKey(),
		kind: text('kind', { enum: ACTION_KINDS }).notNull(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id),
		ipHash: text('ip_hash').notNull(),
		/** 「わかる」では課題の id */
		targetId: integer('target_id'),
		createdAt: integer('created_at').notNull()
	},
	(t) => [
		index('actions_user').on(t.userId, t.kind, t.createdAt),
		index('actions_ip').on(t.ipHash, t.kind, t.createdAt),
		index('actions_target').on(t.targetId, t.kind, t.createdAt),
		check('actions_kind', sql`${t.kind} IN (${sql.raw(ACTION_KINDS.map((k) => `'${k}'`).join(', '))})`)
	]
);

/** アカウントの締め出し。期限が来たら効かない */
export const bans = sqliteTable('bans', {
	userId: text('user_id')
		.primaryKey()
		.references(() => user.id, { onDelete: 'cascade' }),
	until: integer('until').notNull(),
	createdAt: integer('created_at').notNull()
});

export const REPORT_REASONS_DB = ['attack', 'spam', 'duplicate', 'other', 'none'] as const;

/** 課題の通報（設計書 docs/spec/28.md）。1人1課題1回 */
export const reports = sqliteTable(
	'reports',
	{
		id: integer('id').primaryKey(),
		issueId: integer('issue_id')
			.notNull()
			.references(() => issues.id),
		userId: text('user_id')
			.notNull()
			.references(() => user.id),
		reason: text('reason', { enum: REPORT_REASONS_DB }).notNull(),
		/** 「その他」の説明。運営だけが見る */
		note: text('note'),
		/** 自動非表示の数に入れるか（同じ課題がほかにある、登録から24時間たっていない人の通報は入れない） */
		counted: integer('counted', { mode: 'boolean' }).notNull(),
		createdAt: integer('created_at').notNull()
	},
	(t) => [
		unique().on(t.issueId, t.userId),
		index('reports_user').on(t.userId, t.createdAt),
		check('reports_reason', sql`${t.reason} IN (${sql.raw(REPORT_REASONS_DB.map((r) => `'${r}'`).join(', '))})`)
	]
);

/** 公開する対応の記録。issues.status の変更でトリガーが書く。actor_user_id は公開しない */
export const moderationLogs = sqliteTable(
	'moderation_logs',
	{
		id: integer('id').primaryKey(),
		issueId: integer('issue_id')
			.notNull()
			.references(() => issues.id),
		action: text('action', { enum: ['auto_hide', 'hide', 'restore', 'merge'] }).notNull(),
		actor: text('actor', { enum: MODERATION_ACTORS }).notNull(),
		actorUserId: text('actor_user_id'),
		reason: text('reason', { enum: HIDE_LOG_REASONS }),
		note: text('note'),
		/** 統合したときの統合先 */
		mergedInto: integer('merged_into'),
		/** 解決策への対応のとき（設計書 docs/spec/36.md）。外部キーは付けない（付けると drizzle-kit が表を作り直すおそれがある） */
		solutionId: integer('solution_id'),
		createdAt: integer('created_at').notNull()
	},
	(t) => [index('moderation_logs_issue').on(t.issueId), index('moderation_logs_actor_user').on(t.actorUserId, t.createdAt)]
);

// 解決策（設計書 docs/spec/34.md）

export const solutions = sqliteTable(
	'solutions',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		/** 課題を統合すると、トリガーが統合先に付け替える */
		issueId: integer('issue_id')
			.notNull()
			.references(() => issues.id),
		userId: text('user_id')
			.notNull()
			.references(() => user.id),
		body: text('body').notNull(),
		createdAt: integer('created_at').notNull(),
		// 通報と非表示（設計書 docs/spec/36.md）。課題と同じく、status を変えるとトリガー（solutions_status_log）が記録を書く。
		// トリガーは drizzle/0007_solution_reports.sql に手で書いたもので、drizzle のスナップショットにない。
		// この表を作り直すマイグレーションでは、トリガーも消えるので書き直すこと
		status: text('status', { enum: ['visible', 'auto_hidden', 'hidden', 'restored'] }).notNull().default('visible'),
		statusActor: text('status_actor', { enum: MODERATION_ACTORS }),
		statusActorUserId: text('status_actor_user_id'),
		statusReason: text('status_reason', { enum: HIDE_LOG_REASONS }),
		statusNote: text('status_note'),
		statusChangedAt: integer('status_changed_at')
	},
	(t) => [index('solutions_issue_id').on(t.issueId)]
);

/** support＝わかる、changed＝考えが変わった（立場は記録しない）。値はルールの側（domain/solutions）に1つだけ持つ */
const REACTION_KINDS = REACTIONS;

export const solutionReactions = sqliteTable(
	'solution_reactions',
	{
		solutionId: integer('solution_id')
			.notNull()
			.references(() => solutions.id),
		userId: text('user_id')
			.notNull()
			.references(() => user.id),
		kind: text('kind', { enum: REACTION_KINDS }).notNull(),
		createdAt: integer('created_at').notNull()
	},
	(t) => [
		primaryKey({ columns: [t.solutionId, t.userId, t.kind] }),
		check('solution_reactions_kind', sql`${t.kind} IN (${sql.raw(REACTION_KINDS.map((k) => `'${k}'`).join(', '))})`)
	]
);

export const SOLUTION_REPORT_REASONS_DB = ['attack', 'spam', 'other', 'none'] as const;

/** 解決策の通報（設計書 docs/spec/36.md）。課題の reports とは別の表（課題の一意の索引を変えないため） */
export const solutionReports = sqliteTable(
	'solution_reports',
	{
		id: integer('id').primaryKey(),
		solutionId: integer('solution_id')
			.notNull()
			.references(() => solutions.id),
		userId: text('user_id')
			.notNull()
			.references(() => user.id),
		reason: text('reason', { enum: SOLUTION_REPORT_REASONS_DB }).notNull(),
		note: text('note'),
		counted: integer('counted', { mode: 'boolean' }).notNull(),
		createdAt: integer('created_at').notNull()
	},
	(t) => [
		unique().on(t.solutionId, t.userId),
		index('solution_reports_user').on(t.userId, t.createdAt),
		check(
			'solution_reports_reason',
			sql`${t.reason} IN (${sql.raw(SOLUTION_REPORT_REASONS_DB.map((r) => `'${r}'`).join(', '))})`
		)
	]
);

// 委員会と法案の下書き（設計書 docs/spec/45.md）

/** 委員会。最初の行（1, 消費者保護）は drizzle/0009 の末尾に手で INSERT した */
export const committees = sqliteTable('committees', {
	id: integer('id').primaryKey(),
	name: text('name').notNull(),
	createdAt: integer('created_at')
		.notNull()
		.default(sql`(unixepoch() * 1000)`)
});

/** 委員会の対象法令。laws と同じく取り込み（seed.ts）で入れる（laws はマイグレーションでは入らないため） */
export const committeeLaws = sqliteTable(
	'committee_laws',
	{
		committeeId: integer('committee_id')
			.notNull()
			.references(() => committees.id),
		lawId: text('law_id')
			.notNull()
			.references(() => laws.id)
	},
	(t) => [primaryKey({ columns: [t.committeeId, t.lawId] })]
);

/** v0.4 で withdrawn・passed などを足す。表を作り直さないよう、DB には CHECK を付けない */
export const BILL_STATUSES = ['draft', 'proposed', 'withdrawn'] as const;
const inList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(', '));

/**
 * 法案。中身（対象の法令・変更点・元になった解決策）は版（rev）ごとの子の行にあり、rev が指す版だけを読む。
 * rev = 0 は作りかけで、ないものとして扱う（引くときは src/lib/server/bills.ts の savedBill を使う）
 */
export const bills = sqliteTable(
	'bills',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		/** 提出者 */
		userId: text('user_id')
			.notNull()
			.references(() => user.id),
		committeeId: integer('committee_id')
			.notNull()
			.references(() => committees.id),
		/** 作ったあとは変えない */
		kind: text('kind', { enum: BILL_KINDS }).notNull(),
		status: text('status', { enum: BILL_STATUSES }).notNull().default('draft'),
		/** 読む版 */
		rev: integer('rev').notNull().default(0),
		/** 次に使う版の番号（保存のたびに UPDATE … RETURNING で取る） */
		nextRev: integer('next_rev').notNull().default(1),
		title: text('title').notNull(),
		/** 誰が困っているか */
		affected: text('affected').notNull(),
		sideEffects: text('side_effects').notNull(),
		/** 3行要約（改行で区切る） */
		summary: text('summary'),
		/** 附則の本文 */
		supplementary: text('supplementary'),
		createdAt: integer('created_at').notNull(),
		updatedAt: integer('updated_at').notNull(),
		/** 発議した時刻。締切の前か後かは会期と比べて求める（#50） */
		proposedAt: integer('proposed_at'),
		/** 発議した版。賛同者はこの版の行を数える（設計書 docs/spec/68.md 決めたこと8） */
		proposedRev: integer('proposed_rev'),
		/** 出し直しの元の法案（設計書 docs/spec/75.md）。下書きを確定するときに入れる */
		resubmittedFrom: integer('resubmitted_from').references((): AnySQLiteColumn => bills.id),
		/** 撤回した時刻（設計書 docs/spec/76.md）。統合案で取り下げられたかは bill_relations で分かる */
		withdrawnAt: integer('withdrawn_at')
	},
	(t) => [
		index('bills_user').on(t.userId),
		index('bills_status_updated').on(t.status, t.updatedAt),
		index('bills_status_created').on(t.status, t.createdAt),
		index('bills_resubmitted_from').on(t.resubmittedFrom),
		check('bills_kind', sql`${t.kind} IN (${inList(BILL_KINDS)})`)
	]
);

/**
 * 共同提出者（設計書 docs/spec/76.md）。id はフォームで相手を指すのに使い、他人の内部IDをページに載せない。
 * 権限があるのは accepted だけ（申し出は本人だけで作れる）。left と declined は変わらない
 */
export const billCosponsors = sqliteTable(
	'bill_cosponsors',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		billId: integer('bill_id')
			.notNull()
			.references(() => bills.id),
		userId: text('user_id')
			.notNull()
			.references(() => user.id),
		status: text('status', { enum: ['requested', 'accepted', 'left', 'declined'] }).notNull(),
		createdAt: integer('created_at').notNull(),
		acceptedAt: integer('accepted_at')
	},
	(t) => [unique('bill_cosponsors_bill_user').on(t.billId, t.userId), index('bill_cosponsors_user').on(t.userId), check('bill_cosponsors_status', sql`${t.status} IN ('requested', 'accepted', 'left', 'declined')`)]
);

/** 撤回の同意。発議した版ごとに数える（要調整を直して発議し直すと前の同意は数えない） */
export const billWithdrawConsents = sqliteTable(
	'bill_withdraw_consents',
	{
		billId: integer('bill_id')
			.notNull()
			.references(() => bills.id),
		proposedRev: integer('proposed_rev').notNull(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id),
		createdAt: integer('created_at').notNull()
	},
	(t) => [primaryKey({ columns: [t.billId, t.proposedRev, t.userId] })]
);

/** 統合案と元の法案のつながり */
export const billRelations = sqliteTable(
	'bill_relations',
	{
		mergedBillId: integer('merged_bill_id')
			.notNull()
			.references(() => bills.id),
		originBillId: integer('origin_bill_id')
			.notNull()
			.references(() => bills.id),
		createdAt: integer('created_at').notNull()
	},
	(t) => [primaryKey({ columns: [t.mergedBillId, t.originBillId] }), index('bill_relations_origin').on(t.originBillId), check('bill_relations_differ', sql`${t.mergedBillId} <> ${t.originBillId}`)]
);

/** 統合案への同意。rev が統合案のいまの版の行だけ数える（読んでいない条文への同意で自分の法案が撤回にならないように） */
export const billMergeConsents = sqliteTable(
	'bill_merge_consents',
	{
		mergedBillId: integer('merged_bill_id').notNull(),
		originBillId: integer('origin_bill_id').notNull(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id),
		rev: integer('rev').notNull(),
		createdAt: integer('created_at').notNull()
	},
	(t) => [
		primaryKey({ columns: [t.mergedBillId, t.originBillId, t.userId] }),
		foreignKey({ columns: [t.mergedBillId, t.originBillId], foreignColumns: [billRelations.mergedBillId, billRelations.originBillId] })
	]
);

/** 法案の対象の法令（版ごと）。seq 0 が主の法令 */
export const billLaws = sqliteTable(
	'bill_laws',
	{
		billId: integer('bill_id')
			.notNull()
			.references(() => bills.id),
		rev: integer('rev').notNull(),
		seq: integer('seq').notNull(),
		action: text('action', { enum: BILL_KINDS }).notNull(),
		/** 制定の新法は NULL */
		lawId: text('law_id').references(() => laws.id),
		/** 基にした版（書く画面を開いたときの現在の版）。新法は NULL */
		baseRevisionId: text('base_revision_id').references(() => lawRevisions.id),
		/** 制定の法令名 */
		newTitle: text('new_title'),
		/** 基にした IF世界の版（docs/spec/72.md）。0 は分岐した版そのもの。base_revision_id は分岐した版を指す */
		baseIfSeq: integer('base_if_seq').notNull().default(0)
	},
	(t) => [
		primaryKey({ columns: [t.billId, t.rev, t.seq] }),
		unique('bill_laws_law').on(t.billId, t.rev, t.lawId),
		check('bill_laws_seq', sql`${t.seq} BETWEEN 0 AND 4`),
		check('bill_laws_action', sql`${t.action} IN (${inList(BILL_KINDS)})`),
		check(
			'bill_laws_shape',
			sql`(${t.action} = 'enact') = (${t.lawId} IS NULL AND ${t.baseRevisionId} IS NULL AND ${t.newTitle} IS NOT NULL)
				AND (${t.action} <> 'enact') = (${t.lawId} IS NOT NULL AND ${t.baseRevisionId} IS NOT NULL AND ${t.newTitle} IS NULL)`
		)
	]
);

/** 条ごとの変更点（版ごと）。body は変更後の項と号の JSON（parse.ts の Paragraph[]） */
export const billChanges = sqliteTable(
	'bill_changes',
	{
		billId: integer('bill_id').notNull(),
		rev: integer('rev').notNull(),
		lawSeq: integer('law_seq').notNull(),
		/** 条の番号（e-Gov の形。3_2） */
		num: text('num').notNull(),
		op: text('op', { enum: CHANGE_OPS }).notNull(),
		/** amend・delete の対象の条の内部ID */
		provisionId: integer('provision_id').references(() => provisions.id),
		caption: text('caption'),
		body: text('body')
	},
	(t) => [
		primaryKey({ columns: [t.billId, t.rev, t.lawSeq, t.num] }),
		foreignKey({ columns: [t.billId, t.rev, t.lawSeq], foreignColumns: [billLaws.billId, billLaws.rev, billLaws.seq] }),
		check('bill_changes_op', sql`${t.op} IN (${inList(CHANGE_OPS)})`),
		check('bill_changes_provision', sql`(${t.op} = 'add') = (${t.provisionId} IS NULL)`),
		check('bill_changes_body', sql`(${t.op} = 'delete') = (${t.body} IS NULL)`)
	]
);

/** 元になった解決策（版ごと） */
export const billSolutions = sqliteTable(
	'bill_solutions',
	{
		billId: integer('bill_id')
			.notNull()
			.references(() => bills.id),
		rev: integer('rev').notNull(),
		seq: integer('seq').notNull(),
		solutionId: integer('solution_id')
			.notNull()
			.references(() => solutions.id)
	},
	(t) => [
		primaryKey({ columns: [t.billId, t.rev, t.seq] }),
		unique('bill_solutions_solution').on(t.billId, t.rev, t.solutionId),
		check('bill_solutions_seq', sql`${t.seq} BETWEEN 0 AND 4`)
	]
);

/**
 * 賛同。賛同したときの版（rev）に結び付け、bills.rev と同じ rev の行だけを数える（設計書 docs/spec/49.md 決めたこと1）。
 * 保存すると rev が変わるので、行を消さなくても賛同は数えなくなる
 */
export const billSupports = sqliteTable(
	'bill_supports',
	{
		billId: integer('bill_id')
			.notNull()
			.references(() => bills.id),
		rev: integer('rev').notNull(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id),
		createdAt: integer('created_at').notNull()
	},
	(t) => [primaryKey({ columns: [t.billId, t.rev, t.userId] })]
);

/** 会期ごとの今月の参加者（発議要件の母数）。その会期で最初に読まれたときに、一つ前の会期から数えて固定する（設計書 決めたこと3） */
export const sessionParticipantCounts = sqliteTable(
	'session_participants',
	{
		committeeId: integer('committee_id')
			.notNull()
			.references(() => committees.id),
		/** Session.key */
		sessionKey: text('session_key').notNull(),
		activeCount: integer('active_count').notNull(),
		fixedAt: integer('fixed_at').notNull()
	},
	(t) => [primaryKey({ columns: [t.committeeId, t.sessionKey] })]
);

/**
 * 票（設計書 docs/spec/65.md）。1人1法案1会期に最後の1つだけを持つ。
 * 要調整の法案は次の会期にもう一度採決するので、主キーに会期を入れる
 */
export const votes = sqliteTable(
	'votes',
	{
		/** Session.key */
		sessionKey: text('session_key').notNull(),
		billId: integer('bill_id')
			.notNull()
			.references(() => bills.id),
		userId: text('user_id')
			.notNull()
			.references(() => user.id),
		choice: text('choice', { enum: VOTE_CHOICES }).notNull(),
		createdAt: integer('created_at').notNull(),
		updatedAt: integer('updated_at').notNull()
	},
	(t) => [
		primaryKey({ columns: [t.sessionKey, t.billId, t.userId] }),
		index('votes_user').on(t.userId),
		check('votes_choice', sql`${t.choice} IN (${inList(VOTE_CHOICES)})`)
	]
);

/**
 * くじで割り当てた法案（設計書 docs/spec/65.md 決めたこと8）。
 * 主キーを seq にして1文で入れるので、同時に開いても先に入った組だけが残る
 */
export const voteAssignments = sqliteTable(
	'vote_assignments',
	{
		sessionKey: text('session_key').notNull(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id),
		/** 0〜2。4本以上にするときは、この CHECK のために表を作り直す */
		seq: integer('seq').notNull(),
		billId: integer('bill_id')
			.notNull()
			.references(() => bills.id),
		createdAt: integer('created_at').notNull()
	},
	(t) => [
		primaryKey({ columns: [t.sessionKey, t.userId, t.seq] }),
		unique().on(t.sessionKey, t.userId, t.billId),
		check('vote_assignments_seq', sql`${t.seq} BETWEEN 0 AND 2`)
	]
);

const POST_STATUSES = ['visible', 'auto_hidden', 'hidden', 'restored'] as const;

/**
 * 質疑・答弁・補足（設計書 docs/spec/66.md）。答弁と補足の parent_id はその質疑。
 * session_key は付託先の会期（要調整で次の会期に審議するときに分けるため）。
 * role の値と status には CHECK を付けない（#76 と通報の Issue で値を足すときに、自己参照のある表を作り直さないため）
 */
export const posts = sqliteTable(
	'posts',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		billId: integer('bill_id')
			.notNull()
			.references(() => bills.id),
		sessionKey: text('session_key').notNull(),
		kind: text('kind', { enum: POST_KINDS }).notNull(),
		parentId: integer('parent_id'),
		userId: text('user_id')
			.notNull()
			.references(() => user.id),
		role: text('role').$type<PostRole>(),
		body: text('body').notNull(),
		// 通報と非表示（設計書 docs/spec/80.md）。status を変えると、トリガー（posts_status_log）が下の status_* の値で bill_moderation_logs に記録を書く。
		// トリガーは drizzle/0023_post_reports.sql に手で書いたもので、drizzle のスナップショットにない。この表を作り直すマイグレーションでは、トリガーも消えるので書き直すこと。
		// 列を足すと createPost の答弁と補足の INSERT（全列をこの順に SELECT する）も直すこと
		status: text('status', { enum: POST_STATUSES }).notNull().default('visible'),
		createdAt: integer('created_at').notNull(),
		/** 書いた時点の立場（設計書 docs/spec/67.md 決めたこと6）。非公開。CHECK を足すと表が作り直されるので、値は型で絞る */
		stance: text('stance', { enum: STANCES }).notNull().default('undecided'),
		statusActor: text('status_actor', { enum: MODERATION_ACTORS }),
		/** 対応した人。公開しない */
		statusActorUserId: text('status_actor_user_id'),
		statusReason: text('status_reason', { enum: HIDE_LOG_REASONS }),
		statusNote: text('status_note'),
		statusChangedAt: integer('status_changed_at')
	},
	(t) => [
		foreignKey({ columns: [t.parentId], foreignColumns: [t.id] }),
		index('posts_session').on(t.sessionKey),
		index('posts_bill').on(t.billId, t.kind, t.id),
		index('posts_parent').on(t.parentId),
		index('posts_user').on(t.userId),
		check('posts_kind', sql`${t.kind} IN (${inList(POST_KINDS)})`),
		check('posts_parent_kind', sql`(${t.kind} = 'question') = (${t.parentId} IS NULL)`),
		check('posts_role_kind', sql`(${t.kind} = 'answer') = (${t.role} IS NOT NULL)`)
	]
);

/** 質疑・答弁・補足の通報（設計書 docs/spec/80.md）。counted は登録から24時間たっていて、その法案に関わっていないか */
export const postReports = sqliteTable(
	'post_reports',
	{
		id: integer('id').primaryKey(),
		postId: integer('post_id')
			.notNull()
			.references(() => posts.id),
		userId: text('user_id')
			.notNull()
			.references(() => user.id),
		reason: text('reason', { enum: SOLUTION_REPORT_REASONS_DB }).notNull(),
		note: text('note'),
		counted: integer('counted', { mode: 'boolean' }).notNull(),
		createdAt: integer('created_at').notNull()
	},
	(t) => [unique().on(t.postId, t.userId), index('post_reports_user').on(t.userId, t.createdAt), check('post_reports_reason', sql`${t.reason} IN (${inList(SOLUTION_REPORT_REASONS_DB)})`)]
);

/**
 * 法案の投稿への対応の記録（設計書 docs/spec/80.md）。行を書くのはトリガーだけ。moderation_logs は issue_id が NOT NULL なので別の表にする。
 * post_id が NULL 可なのは、#103 で修正案の行を入れるため。action と actor に CHECK を付けないのは、#104 で値を足すときに作り直さないため
 */
export const billModerationLogs = sqliteTable(
	'bill_moderation_logs',
	{
		id: integer('id').primaryKey(),
		billId: integer('bill_id')
			.notNull()
			.references(() => bills.id),
		postId: integer('post_id').references(() => posts.id),
		action: text('action', { enum: ['auto_hide', 'hide', 'restore'] }).notNull(),
		actor: text('actor', { enum: MODERATION_ACTORS }).notNull(),
		actorUserId: text('actor_user_id'),
		reason: text('reason', { enum: HIDE_LOG_REASONS }),
		note: text('note'),
		createdAt: integer('created_at').notNull(),
		/** 修正案への対応のとき（設計書 docs/spec/103.md）。外部キーは付けない（付けると drizzle-kit が表を作り直すおそれがある） */
		amendmentId: integer('amendment_id')
	},
	(t) => [index('bill_moderation_logs_actor_user').on(t.actorUserId, t.createdAt)]
);

/**
 * いまの立場（設計書 docs/spec/66.md 決めたこと6）。非公開で、本人の行だけを読む。行がなければ未定。
 * 変更の履歴（stance_log）はトリガーで足す。トリガーは 0012 の末尾に手で足した
 */
export const stances = sqliteTable(
	'stances',
	{
		sessionKey: text('session_key').notNull(),
		billId: integer('bill_id')
			.notNull()
			.references(() => bills.id),
		userId: text('user_id')
			.notNull()
			.references(() => user.id),
		stance: text('stance', { enum: STANCES }).notNull(),
		/** 最初に選んだあとで変えた回数 */
		changes: integer('changes').notNull().default(0),
		updatedAt: integer('updated_at').notNull()
	},
	(t) => [primaryKey({ columns: [t.sessionKey, t.billId, t.userId] }), check('stances_stance', sql`${t.stance} IN (${inList(STANCES)})`)]
);

/** 立場の変更の履歴（仕様「変更履歴つき」）。stances のトリガーだけが書く */
export const stanceLog = sqliteTable(
	'stance_log',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		sessionKey: text('session_key').notNull(),
		billId: integer('bill_id')
			.notNull()
			.references(() => bills.id),
		userId: text('user_id')
			.notNull()
			.references(() => user.id),
		stance: text('stance', { enum: STANCES }).notNull(),
		createdAt: integer('created_at').notNull()
	},
	(t) => [index('stance_log_bill').on(t.billId, t.sessionKey)]
);

/** 読んだ記録（設計書 docs/spec/67.md 決めたこと4）。読んだ時点の立場で1行。非公開 */
export const postViews = sqliteTable(
	'post_views',
	{
		postId: integer('post_id')
			.notNull()
			.references(() => posts.id),
		userId: text('user_id')
			.notNull()
			.references(() => user.id),
		stance: text('stance', { enum: STANCES }).notNull(),
		createdAt: integer('created_at').notNull()
	},
	(t) => [primaryKey({ columns: [t.postId, t.userId] }), check('post_views_stance', sql`${t.stance} IN (${inList(STANCES)})`)]
);

/** 質疑と答弁の評価（設計書 docs/spec/67.md 決めたこと2・5）。押した時点の立場で1行。取り消すと行を消す。非公開 */
export const evaluations = sqliteTable(
	'evaluations',
	{
		postId: integer('post_id')
			.notNull()
			.references(() => posts.id),
		userId: text('user_id')
			.notNull()
			.references(() => user.id),
		kind: text('kind', { enum: EVALUATION_KINDS }).notNull(),
		stance: text('stance', { enum: STANCES }).notNull(),
		createdAt: integer('created_at').notNull()
	},
	(t) => [
		primaryKey({ columns: [t.postId, t.userId, t.kind] }),
		index('evaluations_user').on(t.userId),
		check('evaluations_kind', sql`${t.kind} IN (${inList(EVALUATION_KINDS)})`),
		check('evaluations_stance', sql`${t.stance} IN (${inList(STANCES)})`)
	]
);

/**
 * 修正案（設計書 docs/spec/68.md）。1つの条の本文の書きかえ。base_rev は基にした本案の版、revision は本文の版（賛同を結び付ける）。
 * status に CHECK を付けない（通報の Issue で値を足すときに表を作り直さないため。値は型で絞る）。applied_rev は本案に当てた版
 */
export const amendments = sqliteTable(
	'amendments',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		billId: integer('bill_id')
			.notNull()
			.references(() => bills.id),
		sessionKey: text('session_key').notNull(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id),
		baseRev: integer('base_rev').notNull(),
		revision: integer('revision').notNull().default(1),
		lawSeq: integer('law_seq').notNull(),
		num: text('num').notNull(),
		provisionId: integer('provision_id').references(() => provisions.id),
		/** 書いたときの見出し。見出しは変えない */
		caption: text('caption'),
		/** 変更後の項と号の JSON（parse.ts の Paragraph[]） */
		body: text('body').notNull(),
		reason: text('reason'),
		status: text('status').$type<AmendmentStatus>().notNull().default('open'),
		appliedRev: integer('applied_rev'),
		createdAt: integer('created_at').notNull(),
		updatedAt: integer('updated_at').notNull(),
		// 通報と非表示（設計書 docs/spec/103.md）。status と別に持つ（共同起草者と結果を status から求めているので）。
		// moderation_status を変えると、トリガー（amendments_moderation_log）が下の moderation_* の値で bill_moderation_logs に記録を書く。
		// トリガーは drizzle/0024_amendment_reports.sql に手で書いたもので、drizzle のスナップショットにない。この表を作り直すマイグレーションでは、トリガーも消えるので書き直すこと
		moderationStatus: text('moderation_status', { enum: ['visible', 'auto_hidden', 'hidden', 'restored'] }).notNull().default('visible'),
		moderationActor: text('moderation_actor', { enum: MODERATION_ACTORS }),
		/** 対応した人。公開しない */
		moderationActorUserId: text('moderation_actor_user_id'),
		moderationReason: text('moderation_reason', { enum: HIDE_LOG_REASONS }),
		moderationNote: text('moderation_note'),
		moderationChangedAt: integer('moderation_changed_at')
	},
	(t) => [index('amendments_bill').on(t.billId, t.id), index('amendments_user').on(t.userId)]
);

/** 修正案の通報（設計書 docs/spec/103.md）。counted は登録から24時間たっているかだけ（関わりは数えるときに判定する）。revision は通報したときの本文 */
export const amendmentReports = sqliteTable(
	'amendment_reports',
	{
		id: integer('id').primaryKey(),
		amendmentId: integer('amendment_id')
			.notNull()
			.references(() => amendments.id),
		userId: text('user_id')
			.notNull()
			.references(() => user.id),
		reason: text('reason', { enum: SOLUTION_REPORT_REASONS_DB }).notNull(),
		note: text('note'),
		counted: integer('counted', { mode: 'boolean' }).notNull(),
		revision: integer('revision').notNull(),
		createdAt: integer('created_at').notNull()
	},
	(t) => [unique().on(t.amendmentId, t.userId), index('amendment_reports_user').on(t.userId, t.createdAt), check('amendment_reports_reason', sql`${t.reason} IN (${inList(SOLUTION_REPORT_REASONS_DB)})`)]
);

/** 本案より先に採決するための賛同。amendments.revision と同じ値の行だけを数える */
export const amendmentSupports = sqliteTable(
	'amendment_supports',
	{
		amendmentId: integer('amendment_id')
			.notNull()
			.references(() => amendments.id),
		revision: integer('revision').notNull(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id),
		createdAt: integer('created_at').notNull()
	},
	(t) => [primaryKey({ columns: [t.amendmentId, t.revision, t.userId] })]
);

/** 修正案の票。votes と同じ形 */
export const amendmentVotes = sqliteTable(
	'amendment_votes',
	{
		sessionKey: text('session_key').notNull(),
		amendmentId: integer('amendment_id')
			.notNull()
			.references(() => amendments.id),
		userId: text('user_id')
			.notNull()
			.references(() => user.id),
		choice: text('choice', { enum: VOTE_CHOICES }).notNull(),
		createdAt: integer('created_at').notNull(),
		updatedAt: integer('updated_at').notNull()
	},
	(t) => [primaryKey({ columns: [t.sessionKey, t.amendmentId, t.userId] }), check('amendment_votes_choice', sql`${t.choice} IN (${inList(VOTE_CHOICES)})`)]
);

/**
 * 法案の採決の結果（設計書 docs/spec/71.md）。行は一度入れたら変えない。
 * 要調整の法案は次の会期にもう一度採決するので、主キーに会期を入れる（votes と同じ）。rev は数えたときの本案の版で、修正案を当てたあと
 */
export const billResults = sqliteTable(
	'bill_results',
	{
		sessionKey: text('session_key').notNull(),
		billId: integer('bill_id')
			.notNull()
			.references(() => bills.id),
		outcome: text('outcome', { enum: BILL_OUTCOMES }).notNull(),
		yes: integer('yes').notNull(),
		no: integer('no').notNull(),
		abstain: integer('abstain').notNull(),
		refYes: integer('ref_yes').notNull(),
		refNo: integer('ref_no').notNull(),
		refAbstain: integer('ref_abstain').notNull(),
		participants: integer('participants').notNull(),
		quorum: integer('quorum').notNull(),
		rev: integer('rev').notNull(),
		settledAt: integer('settled_at').notNull()
	},
	(t) => [primaryKey({ columns: [t.sessionKey, t.billId] }), index('bill_results_bill').on(t.billId), check('bill_results_outcome', sql`${t.outcome} IN (${inList(BILL_OUTCOMES)})`)]
);

/** 法令ごとの、IF世界が分岐した現実の版（設計書 docs/spec/72.md 決めたこと1） */
export const ifBranches = sqliteTable('if_branches', {
	lawId: text('law_id')
		.primaryKey()
		.references(() => laws.id),
	revisionId: text('revision_id')
		.notNull()
		.references(() => lawRevisions.id),
	createdAt: integer('created_at').notNull()
});

/**
 * IF世界の版。中身を写さず、可決した法案の版の bill_changes を指す（法案の版の行は変わらない）。
 * law_revisions には入れない（branch の CHECK と e-Gov の番号のため）
 */
export const ifRevisions = sqliteTable(
	'if_revisions',
	{
		lawId: text('law_id')
			.notNull()
			.references(() => laws.id),
		/** 1から */
		seq: integer('seq').notNull(),
		billId: integer('bill_id').notNull(),
		billRev: integer('bill_rev').notNull(),
		lawSeq: integer('law_seq').notNull(),
		sessionKey: text('session_key').notNull(),
		createdAt: integer('created_at').notNull()
	},
	(t) => [
		primaryKey({ columns: [t.lawId, t.seq] }),
		unique('if_revisions_bill').on(t.billId, t.billRev, t.lawSeq),
		foreignKey({ columns: [t.billId, t.billRev, t.lawSeq], foreignColumns: [billLaws.billId, billLaws.rev, billLaws.seq] })
	]
);

/**
 * 現実の改正の取り込み（設計書 docs/spec/95.md）。「ここから基にする現実の版が変わる」行で、seq は if_revisions と同じ番号の列。
 * 反映と取り込みの行は、両方の表の MAX + 1 を求める1つの文で入れる
 */
export const ifImports = sqliteTable(
	'if_imports',
	{
		lawId: text('law_id')
			.notNull()
			.references(() => laws.id),
		seq: integer('seq').notNull(),
		revisionId: text('revision_id')
			.notNull()
			.references(() => lawRevisions.id),
		/** 取り込んだ会期 */
		sessionKey: text('session_key').notNull(),
		createdAt: integer('created_at').notNull()
	},
	(t) => [primaryKey({ columns: [t.lawId, t.seq] }), unique('if_imports_revision').on(t.lawId, t.revisionId)]
);

/** 取り込みで変わった条。ぶつかった行は当時の条文を写す（あとで IF世界が変わっても当時の内容を読めるように） */
export const ifImportArticles = sqliteTable(
	'if_import_articles',
	{
		lawId: text('law_id').notNull(),
		revisionId: text('revision_id').notNull(),
		/** 新しい版の条（なくなった条は前の版の条） */
		provisionId: integer('provision_id')
			.notNull()
			.references(() => provisions.id),
		/** 現実の番号（なくなった条は前の番号） */
		num: text('num').notNull(),
		prevNum: text('prev_num'),
		change: text('change', { enum: ['amended', 'renumbered', 'added', 'removed'] }).notNull(),
		conflict: integer('conflict').notNull(),
		realCaption: text('real_caption'),
		/** NULL は現実でなくなった条（ぶつかった行のとき） */
		realBody: text('real_body'),
		ifNum: text('if_num'),
		ifCaption: text('if_caption'),
		/** NULL は IF世界で削除した条（ぶつかった行のとき） */
		ifBody: text('if_body'),
		billId: integer('bill_id').references(() => bills.id),
		/** 似ていなくて内部IDが変わった条の、閉じた内部ID */
		closedProvisionId: integer('closed_provision_id').references(() => provisions.id)
	},
	(t) => [
		primaryKey({ columns: [t.lawId, t.revisionId, t.provisionId] }),
		foreignKey({ columns: [t.lawId, t.revisionId], foreignColumns: [ifImports.lawId, ifImports.revisionId] }),
		check('if_import_articles_change', sql`${t.change} IN ('amended', 'renumbered', 'added', 'removed')`),
		check('if_import_articles_conflict', sql`${t.conflict} IN (0, 1)`)
	]
);

/** その会期のその法令の取り込みが終わった記録。会期の途中で IF世界の条文が変わらないように */
export const ifImportRuns = sqliteTable(
	'if_import_runs',
	{
		sessionKey: text('session_key').notNull(),
		lawId: text('law_id')
			.notNull()
			.references(() => laws.id),
		createdAt: integer('created_at').notNull()
	},
	(t) => [primaryKey({ columns: [t.sessionKey, t.lawId] })]
);

/** IF世界で足した条の内部ID。bill_changes の足す行には内部IDがないので、ここに持つ */
export const ifAddedArticles = sqliteTable(
	'if_added_articles',
	{
		lawId: text('law_id')
			.notNull()
			.references(() => laws.id),
		num: text('num').notNull(),
		provisionId: integer('provision_id')
			.notNull()
			.references(() => provisions.id),
		createdAt: integer('created_at').notNull()
	},
	(t) => [primaryKey({ columns: [t.lawId, t.num] })]
);

/** 制定の新法。id は if-<法案の番号>。条は法案の版の bill_changes を読む */
export const ifLaws = sqliteTable('if_laws', {
	id: text('id').primaryKey(),
	billId: integer('bill_id')
		.notNull()
		.unique()
		.references(() => bills.id),
	billRev: integer('bill_rev').notNull(),
	title: text('title').notNull().unique(),
	sessionKey: text('session_key').notNull(),
	createdAt: integer('created_at').notNull()
});

/** 衝突して要調整になった法案。期限切れは書き込まず、時刻から求める（docs/spec/72.md 決めたこと6） */
export const billAdjustments = sqliteTable(
	'bill_adjustments',
	{
		billId: integer('bill_id')
			.notNull()
			.references(() => bills.id),
		/** 衝突した会期 */
		sessionKey: text('session_key').notNull(),
		reason: text('reason', { enum: ADJUSTMENT_REASONS }).notNull(),
		/** 発議締切 */
		dueAt: integer('due_at').notNull(),
		/** 元の発議の時刻 */
		proposedAt: integer('proposed_at').notNull(),
		resolvedAt: integer('resolved_at'),
		createdAt: integer('created_at').notNull()
	},
	(t) => [primaryKey({ columns: [t.billId, t.sessionKey] }), check('bill_adjustments_reason', sql`${t.reason} IN (${inList(ADJUSTMENT_REASONS)})`)]
);

/**
 * 票の偏りの確認（設計書 docs/spec/73.md）。noted は見つかったが可否に関わらないので保留しなかった行。
 * bill_results は変えず、無効はここで表す。decided_by は公開しない
 */
export const voteReviews = sqliteTable(
	'vote_reviews',
	{
		sessionKey: text('session_key').notNull(),
		billId: integer('bill_id')
			.notNull()
			.references(() => bills.id),
		/** 見つかった種類の JSON 配列（ANOMALY_SIGNALS） */
		signals: text('signals').notNull(),
		/** 運営の画面の集計の JSON（AnomalyDetail） */
		detail: text('detail').notNull(),
		status: text('status', { enum: REVIEW_STATUSES }).notNull(),
		note: text('note'),
		decidedRole: text('decided_role', { enum: STAFF_ROLES }),
		decidedBy: text('decided_by'),
		decidedAt: integer('decided_at'),
		createdAt: integer('created_at').notNull()
	},
	(t) => [primaryKey({ columns: [t.sessionKey, t.billId] }), index('vote_reviews_status').on(t.status), index('vote_reviews_bill').on(t.billId), index('vote_reviews_decided_by').on(t.decidedBy, t.decidedAt), check('vote_reviews_status_check', sql`${t.status} IN (${inList(REVIEW_STATUSES)})`)]
);

// 委員長選挙と理事、解任動議（設計書 docs/spec/77.md）

export const CHAIR_ROLES = ['chair', 'director'] as const;

/** 立候補。session_key は選挙をする会期。取り下げると行を消す */
export const chairCandidates = sqliteTable(
	'chair_candidates',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		committeeId: integer('committee_id')
			.notNull()
			.references(() => committees.id),
		sessionKey: text('session_key').notNull(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id),
		createdAt: integer('created_at').notNull()
	},
	(t) => [unique('chair_candidates_user').on(t.committeeId, t.sessionKey, t.userId)]
);

/** 票。入れた人と回線を画面にも API にも出さない。取り下げで票も消すので、候補より先に消す */
export const chairVotes = sqliteTable(
	'chair_votes',
	{
		committeeId: integer('committee_id')
			.notNull()
			.references(() => committees.id),
		sessionKey: text('session_key').notNull(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id),
		candidateId: integer('candidate_id')
			.notNull()
			.references(() => chairCandidates.id),
		ipHash: text('ip_hash').notNull(),
		createdAt: integer('created_at').notNull(),
		updatedAt: integer('updated_at').notNull()
	},
	(t) => [primaryKey({ columns: [t.committeeId, t.sessionKey, t.userId] }), index('chair_votes_candidate').on(t.candidateId), index('chair_votes_line').on(t.committeeId, t.sessionKey, t.ipHash)]
);

/** 委員長と理事。session_key は任期の会期。rank は 0 が委員長で画面に出さない。votes は集計の記録で画面に出さない */
export const chairTerms = sqliteTable(
	'chair_terms',
	{
		committeeId: integer('committee_id')
			.notNull()
			.references(() => committees.id),
		sessionKey: text('session_key').notNull(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id),
		role: text('role', { enum: CHAIR_ROLES }).notNull(),
		rank: integer('rank').notNull(),
		votes: integer('votes').notNull(),
		recalledAt: integer('recalled_at'),
		createdAt: integer('created_at').notNull()
	},
	(t) => [
		primaryKey({ columns: [t.committeeId, t.sessionKey, t.userId] }),
		unique('chair_terms_rank').on(t.committeeId, t.sessionKey, t.rank),
		index('chair_terms_user').on(t.userId, t.sessionKey),
		check('chair_terms_role', sql`${t.role} IN (${inList(CHAIR_ROLES)})`),
		check('chair_terms_rank_role', sql`(${t.rank} = 0) = (${t.role} = 'chair')`)
	]
);

/** 確定の印。候補がいなくても入れる。session_key は選挙をした会期。total_votes は画面に出さない */
export const chairElections = sqliteTable(
	'chair_elections',
	{
		committeeId: integer('committee_id')
			.notNull()
			.references(() => committees.id),
		sessionKey: text('session_key').notNull(),
		totalVotes: integer('total_votes').notNull(),
		settledAt: integer('settled_at').notNull()
	},
	(t) => [primaryKey({ columns: [t.committeeId, t.sessionKey] })]
);

/** 解任の署名。session_key は任期の会期。署名した人と回線を画面にも API にも出さない。取り消すと行を消す */
export const recallSignatures = sqliteTable(
	'recall_signatures',
	{
		committeeId: integer('committee_id')
			.notNull()
			.references(() => committees.id),
		sessionKey: text('session_key').notNull(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id),
		ipHash: text('ip_hash').notNull(),
		createdAt: integer('created_at').notNull()
	},
	(t) => [primaryKey({ columns: [t.committeeId, t.sessionKey, t.userId] }), index('recall_signatures_line').on(t.committeeId, t.sessionKey, t.ipHash)]
);

// アプリ内通知（設計書 docs/spec/78.md）

/** 通知の行。本文は持たず、読むときに kind と題名から作る。kind に CHECK は付けない（種類を足すたびに表の作り直しになる） */
export const notifications = sqliteTable(
	'notifications',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		kind: text('kind').$type<NotificationKind>().notNull(),
		/** 法案、課題、解決策、投稿、委員会の番号（kind で決まる） */
		targetId: integer('target_id').notNull(),
		/** 同じ対象に何度も届くものを分ける。なければ 0 */
		refId: integer('ref_id').notNull(),
		createdAt: integer('created_at').notNull()
	},
	(t) => [unique('notifications_once').on(t.userId, t.kind, t.targetId, t.refId), index('notifications_user').on(t.userId, t.createdAt, t.id)]
);

/** 一覧の1ページ目を開いた時点。行は read_id、時刻から求める項目は read_at より後が未読 */
export const notificationReads = sqliteTable('notification_reads', {
	userId: text('user_id')
		.primaryKey()
		.references(() => user.id, { onDelete: 'cascade' }),
	readAt: integer('read_at').notNull(),
	readId: integer('read_id').notNull()
});
