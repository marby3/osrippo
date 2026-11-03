// 法令と版の DB（設計書 docs/spec/8.md）
import { sql } from 'drizzle-orm';
import { check, foreignKey, index, integer, primaryKey, real, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core';
import { CHANGES } from '../domain/law/history';
import type { Heading } from '../domain/law/parse';

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

export const ISSUE_STATUSES = ['visible', 'auto_hidden', 'hidden', 'restored'] as const;
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
		// 通報と非表示（設計書 docs/spec/28.md）。status を変えると、トリガーが下の status_* の値で moderation_logs に記録を書く
		/** restored は運営が表示に戻した課題（表示するが、自動では非表示にしない） */
		status: text('status', { enum: ISSUE_STATUSES }).notNull().default('visible'),
		statusActor: text('status_actor', { enum: MODERATION_ACTORS }),
		/** 対応した人。公開しない */
		statusActorUserId: text('status_actor_user_id'),
		statusReason: text('status_reason', { enum: HIDE_LOG_REASONS }),
		statusNote: text('status_note'),
		statusChangedAt: integer('status_changed_at')
	},
	(t) => [index('issues_topic_id').on(t.topicId)]
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

export const ACTION_KINDS = ['issue_post', 'support_add', 'support_remove', 'violation'] as const;

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
		action: text('action', { enum: ['auto_hide', 'hide', 'restore'] }).notNull(),
		actor: text('actor', { enum: MODERATION_ACTORS }).notNull(),
		actorUserId: text('actor_user_id'),
		reason: text('reason', { enum: HIDE_LOG_REASONS }),
		note: text('note'),
		createdAt: integer('created_at').notNull()
	},
	(t) => [index('moderation_logs_issue').on(t.issueId)]
);
