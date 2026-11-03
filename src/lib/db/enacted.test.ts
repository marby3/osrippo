// Issue #18：2017年4月より後に制定された法令の、制定の出し方。
// 今の3法には当たる法令がないので、消費者契約法の取り込みデータから 2017年4月1日以前の版を外し、
// 2017-06-02 の版で「制定された法令」として node:sqlite に入れて確かめる
import { beforeAll, describe, expect, test } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { drizzle } from 'drizzle-orm/sqlite-proxy';
import { articleHistory, lawPage, type Db } from '../server/law';
import { ja } from '../copy/ja';
import { BASELINE_DATE } from '../domain/law';
import { seedStatements } from './seed';

const root = new URL('../../../', import.meta.url);
const LAW = '412AC0000000061';
const ENACTED = '2017-06-02';
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`tests/fixtures/egov/${name}.json`, root), 'utf8'));

/** 起点の版を外した取り込みデータ（最初の版が 2017-06-02 になる） */
function enactedFixture(name: string) {
	const data = fixture(name);
	if (name !== `law_revisions_${LAW}`) return data;
	return {
		...data,
		revisions: data.revisions.filter((r: { amendment_enforcement_date: string }) => r.amendment_enforcement_date > BASELINE_DATE)
	};
}

function database(load: (name: string) => unknown): Db {
	const db = new DatabaseSync(':memory:');
	db.exec('PRAGMA foreign_keys = ON');
	const migrations = new URL('drizzle/', root);
	for (const f of readdirSync(migrations).filter((f) => f.endsWith('.sql')).sort()) {
		db.exec(readFileSync(new URL(f, migrations), 'utf8'));
	}
	for (const sql of seedStatements([LAW], load)) db.exec(sql);
	return drizzle(async (sql, params, method) => {
		const stmt = db.prepare(sql);
		stmt.setReturnArrays(true);
		if (method === 'run') return stmt.run(...(params as [])), { rows: [] };
		if (method === 'get') return { rows: stmt.get(...(params as [])) as unknown as unknown[] };
		return { rows: stmt.all(...(params as [])) as unknown as unknown[][] };
	});
}

/** 制定された法令として入れた DB と、本物どおり起点の版がある DB */
let enacted: Db;
let real: Db;
beforeAll(() => {
	enacted = database(enactedFixture);
	real = database(fixture);
}, 120_000);

describe('制定された法令（Issue #18）', () => {
	test('基準1：制定のあと変わっていない条は、制定の日を持ち、改正の日と「変わった記録」を持たない', async () => {
		const page = (await lawPage(enacted, LAW))!;
		const article2 = page.articles.find((a) => a.num === '2')!;
		expect(article2.lastAmended).toBeNull();
		expect(article2.enacted).toBe(ENACTED);
		expect(await articleHistory(enacted, LAW, '2')).toBeUndefined();
		// 1年未満は年数を出さない（改正の1行と同じ）
		expect(ja.law.enacted(ENACTED, 9)).toBe('2017年6月に制定・9年変わっていない');
		expect(ja.law.enacted(ENACTED, 0)).toBe('2017年6月に制定');
		// 起点の版がある法令の条は、今までどおり制定の日を持たない
		const realArticle2 = (await lawPage(real, LAW))!.articles.find((a) => a.num === '2')!;
		expect(realArticle2.enacted).toBeNull();
	});

	test('基準2：制定のあと改正された条は、記録に改正だけを並べ、いちばん古い行が制定', async () => {
		const page = (await lawPage(enacted, LAW))!;
		const article4 = page.articles.find((a) => a.num === '4')!;
		expect(article4.lastAmended).toBe('2023-06-01');

		const record = (await articleHistory(enacted, LAW, '4'))!;
		const realRecord = (await articleHistory(real, LAW, '4'))!;
		expect(record.amendments).toEqual(realRecord.amendments.filter((a) => a.date > ENACTED));
		expect(record.amendments.length).toBeGreaterThan(0);
		expect(record.baseline).toBeNull();
		expect(record.enacted).toEqual({ date: ENACTED, then: null });
		expect(ja.law.enactedOn(ENACTED)).toBe('2017年6月2日 制定');
		// 起点の版がある法令は、今までどおり「2017年4月より前」
		expect(realRecord.enacted).toBeNull();
		expect(realRecord.baseline).not.toBeNull();
	});

	test('基準3：改正履歴に制定の版を並べず、制定の日を別に持つ', async () => {
		const page = (await lawPage(enacted, LAW))!;
		expect(page.enforced.map((r) => r.date)).not.toContain(ENACTED);
		expect(page.enforced.at(-1)!.date > ENACTED).toBe(true);
		expect(page.enacted).toBe(ENACTED);
		expect((await lawPage(real, LAW))!.enacted).toBeNull();
	});
});
