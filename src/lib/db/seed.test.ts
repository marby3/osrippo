// Issue #8 基準2〜6：取り込みの SQL を node:sqlite に流して、設計書（docs/spec/8.md）の引き方で確かめる
import { beforeAll, describe, expect, test } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { parseLaw } from '#lib/domain/law';
import { seedStatements, TARGET_LAWS } from './seed';

const root = new URL('../../../', import.meta.url);
const fixture = (name: string) =>
	JSON.parse(readFileSync(new URL(`tests/fixtures/egov/${name}.json`, root), 'utf8'));

type Row = Record<string, string | number | null>;
let db: DatabaseSync;
const all = (sql: string, ...params: (string | number)[]) => db.prepare(sql).all(...params) as Row[];
const one = (sql: string, ...params: (string | number)[]) => db.prepare(sql).get(...params) as Row | undefined;

beforeAll(() => {
	db = new DatabaseSync(':memory:');
	db.exec('PRAGMA foreign_keys = ON');
	const migrations = new URL('drizzle/', root);
	for (const f of readdirSync(migrations).filter((f) => f.endsWith('.sql')).sort()) {
		db.exec(readFileSync(new URL(f, migrations), 'utf8'));
	}
	for (const sql of seedStatements(TARGET_LAWS, fixture)) db.exec(sql);
}, 120_000);

/** 版 R で有効な行（設計書 決定1） */
const VALID_AT = `
	SELECT p.id AS pid, p.kind, p.parent_id, v.num, v.caption, v.text, v.change, v.unconfirmed_of
	FROM provision_versions v
	JOIN provisions p ON p.id = v.provision_id
	JOIN law_revisions f ON f.id = v.from_revision_id
	LEFT JOIN law_revisions t ON t.id = v.to_revision_id
	JOIN law_revisions r ON r.id = ?
	WHERE p.law_id = r.law_id AND f.branch = r.branch AND f.seq <= r.seq AND (t.id IS NULL OR t.seq > r.seq)`;

/** 設計書の並び順：`_` で区切り、左から数値で比べ、同じなら短いほうが先 */
function byNum(a: Row, b: Row): number {
	const x = String(a.num).split('_').map(Number);
	const y = String(b.num).split('_').map(Number);
	for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i] - y[i];
	return x.length - y.length;
}

function rebuild(revisionId: string) {
	const rows = all(VALID_AT, revisionId);
	const children = (kind: string, parent: number) => rows.filter((r) => r.kind === kind && r.parent_id === parent).sort(byNum);
	return rows
		.filter((r) => r.kind === 'article')
		.sort(byNum)
		.map((a) => ({
			num: a.num,
			caption: a.caption,
			paragraphs: children('paragraph', a.pid as number).map((p) => ({
				num: p.num,
				text: p.text,
				items: children('item', p.pid as number).map((i) => ({ num: i.num, text: i.text }))
			}))
		}));
}

const articleAt = (revisionId: string, num: string) =>
	all(VALID_AT, revisionId).find((r) => r.kind === 'article' && r.num === num);

test('基準2：全版で、DB から組み立て直した条・項・号が本文と一致する', () => {
	const counts: Record<string, number> = {};
	for (const law of TARGET_LAWS) {
		const revisions = all('SELECT id FROM law_revisions WHERE law_id = ? ORDER BY seq', law);
		counts[law] = revisions.length;
		for (const { id } of revisions) {
			const expected = parseLaw(fixture(`law_data_${id}`).law_full_text).map(({ label: _, ...a }) => a);
			expect(rebuild(id as string), String(id)).toEqual(expected);
		}
	}
	expect(counts).toEqual({ '412AC0000000061': 19, '351AC0000000057': 22, '337AC0000000134': 9 });
});

test('基準3：版をまたいで同じ内部IDになる', () => {
	const tokusho = (date: string) => `351AC0000000057_${date}_428AC0000000060`;
	expect(articleAt(tokusho('20171201'), '15_3')?.pid).toBe(articleAt(tokusho('20170602'), '15_2')?.pid);

	const ids = all(
		`SELECT DISTINCT p.id FROM provisions p JOIN provision_versions v ON v.provision_id = p.id
		 WHERE p.law_id = '412AC0000000061' AND p.kind = 'article' AND v.num = '2'`
	);
	expect(ids).toHaveLength(1);
	for (const { id } of all(`SELECT id FROM law_revisions WHERE law_id = '412AC0000000061'`)) {
		expect(articleAt(id as string, '2')?.pid, String(id)).toBe(ids[0].id);
	}
});

describe('現在の版（施行済みのうち seq が最大）', () => {
	const current = (law: string) =>
		one(`SELECT id FROM law_revisions WHERE law_id = ? AND status = 'enforced' ORDER BY seq DESC LIMIT 1`, law)?.id;

	test('基準4：消費者契約法の現在の条文は 2026-06-24 の版', () => {
		const now = '412AC0000000061_20260624_508AC0000000046';
		expect(current('412AC0000000061')).toBe(now);
		const expected = parseLaw(fixture(`law_data_${now}`).law_full_text).map(({ label: _, ...a }) => a);
		const scheduled = parseLaw(fixture('law_data_412AC0000000061_20281223_508AC0000000046').law_full_text);
		expect(scheduled.map(({ label: _, ...a }) => a)).not.toEqual(expected);
		expect(rebuild(current('412AC0000000061') as string)).toEqual(expected);
	});

	test('基準5：最後に改正された日', () => {
		// 設計書 決定3：数える change で、施行済みの版から始まる行のうち最新の施行日
		const lastAmended = (num: string) => {
			const pid = articleAt(current('412AC0000000061') as string, num)?.pid as number;
			return one(
				`SELECT MAX(f.enforcement_date) AS d FROM provision_versions v JOIN law_revisions f ON f.id = v.from_revision_id
				 WHERE v.provision_id = ? AND v.change IN ('added', 'amended', 'unconfirmed') AND f.status = 'enforced'`,
				pid
			)?.d;
		};
		expect(lastAmended('4')).toBe('2023-06-01');
		expect(lastAmended('1')).toBe('2017-06-03');
		expect(lastAmended('2')).toBeNull();
		expect(articleAt(current('412AC0000000061') as string, '2')?.change).toBe('baseline');
		expect(one(`SELECT enforcement_date AS d FROM law_revisions WHERE law_id = '412AC0000000061' AND seq = 0`)?.d).toBe(
			'2016-10-01'
		);
	});
});

test('基準6：特定商取引法 2017-12-01 の第15条の2 は確認待ち', () => {
	const before = articleAt('351AC0000000057_20170602_428AC0000000060', '15_2');
	const after = all(
		`SELECT p.id AS pid, v.change, v.unconfirmed_of FROM provision_versions v JOIN provisions p ON p.id = v.provision_id
		 WHERE v.from_revision_id = '351AC0000000057_20171201_428AC0000000060' AND p.kind = 'article' AND v.num = '15_2'`
	);
	expect(after).toHaveLength(1);
	expect(after[0]).toMatchObject({ change: 'unconfirmed', unconfirmed_of: before?.pid });
	expect(after[0].pid).not.toBe(before?.pid);
	expect(articleAt('351AC0000000057_20171201_428AC0000000060', '15_3')?.pid).toBe(before?.pid);
});
