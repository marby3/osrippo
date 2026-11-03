// 法令と版の DB（設計書 docs/spec/8.md）
import { sql } from 'drizzle-orm';
import { check, foreignKey, index, integer, real, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core';
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
