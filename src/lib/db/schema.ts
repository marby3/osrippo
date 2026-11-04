// 法令と版の DB（設計書 docs/spec/8.md）
import { sql } from 'drizzle-orm';
import { check, foreignKey, index, integer, primaryKey, real, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core';
import { CHANGES } from '../domain/law/history';
import type { Heading } from '../domain/law/parse';
import { REACTIONS } from '../domain/solutions';
import { BILL_KINDS, CHANGE_OPS } from '../domain/bills';

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
export const MODERATION_ACTORS = ['auto', 'moderator', 'operator'] as const;
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
 * bill_* では法案の番号（docs/spec/45.md。v0.3 で使う種類をまとめて足した）
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
	'bill_propose'
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
	(t) => [index('moderation_logs_issue').on(t.issueId)]
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
export const BILL_STATUSES = ['draft', 'proposed'] as const;
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
		proposedAt: integer('proposed_at')
	},
	(t) => [
		index('bills_user').on(t.userId),
		index('bills_status_updated').on(t.status, t.updatedAt),
		index('bills_status_created').on(t.status, t.createdAt),
		check('bills_kind', sql`${t.kind} IN (${inList(BILL_KINDS)})`)
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
		newTitle: text('new_title')
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
