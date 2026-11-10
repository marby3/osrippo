// Issue #128：今日の条文の選び方（基準2・3）。法令のページ（lawPage）の条と「最後に改正された日」を正として比べる
import { beforeAll, describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { openMemoryDb } from './memory';
import { seedStatements, TARGET_LAWS } from './seed';
import { lawPage, type Db } from '../server/law';
import { todayArticle, todayCandidates } from '../server/today';
import { fullYears } from '../domain/law';

const root = new URL('../../../', import.meta.url);
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`tests/fixtures/egov/${name}.json`, root), 'utf8'));

let db: Db;
beforeAll(() => {
	const m = openMemoryDb();
	for (const sql of seedStatements(TARGET_LAWS, fixture)) m.sqlite.exec(sql);
	db = m.db;
});

/** 基準3の条件を、法令のページに出している条から求める */
async function expected(today: string) {
	const out: { lawId: string; num: string; text: string; lastAmended: string | null; enacted: string | null }[] = [];
	for (const lawId of [...TARGET_LAWS].sort()) {
		const page = (await lawPage(db, lawId))!;
		for (const a of page.articles) {
			const [p] = a.paragraphs;
			const changed = a.lastAmended ?? a.enacted;
			if (a.paragraphs.length !== 1 || p.items.length || p.text.length > 120 || p.text === '削除') continue;
			if (changed && fullYears(changed, today) < 1) continue;
			out.push({ lawId, num: a.num, text: p.text, lastAmended: a.lastAmended, enacted: a.enacted });
		}
	}
	return out;
}

describe('基準3：選び方', () => {
	test('候補は、項が1つで号がなく、120字以内で、最後の改正から1年以上たった条（「削除」は入れない）', async () => {
		const today = '2026-11-10';
		const want = await expected(today);
		const got = await todayCandidates(db, today);
		expect(got.map((c) => [c.lawId, c.num])).toEqual(want.map((c) => [c.lawId, c.num]));
		// 改正されていない短い条（消費者契約法 第48条）は入り、項が2つ以上ある条（同 第4条）は入らない
		expect(got.some((c) => c.lawId === '412AC0000000061' && c.num === '48')).toBe(true);
		expect(got.some((c) => c.lawId === '412AC0000000061' && c.num === '4')).toBe(false);
	});

	test('改正から1年たたない条は、1年たった日から候補に入る', async () => {
		// 改正のある候補を1つ選び、その改正の日の1年後の前日と当日で比べる
		const amended = (await expected('2999-01-01')).find((c) => c.lastAmended)!;
		const date = amended.lastAmended!;
		const yearLater = `${Number(date.slice(0, 4)) + 1}${date.slice(4)}`;
		const dayBefore = new Date(Date.parse(`${yearLater}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
		const has = async (today: string) => (await todayCandidates(db, today)).some((c) => c.lawId === amended.lawId && c.num === amended.num);
		expect(await has(dayBefore)).toBe(false);
		expect(await has(yearLater)).toBe(true);
	});

	test('同じ日はいつ選んでも同じ条で、次の日は候補の並びで次の条になる', async () => {
		const today = '2026-11-10';
		const list = await todayCandidates(db, today);
		const a = (await todayArticle(db, today))!;
		expect(await todayArticle(db, today)).toEqual(a);
		const i = list.findIndex((c) => c.lawId === a.lawId && c.num === a.num);
		expect(i).toBeGreaterThanOrEqual(0);
		const b = (await todayArticle(db, '2026-11-11'))!;
		const next = list[(i + 1) % list.length];
		// 次の日の候補は前の日と同じ（1年の区切りをまたぐ条がない日を選んでいる）
		expect((await todayCandidates(db, '2026-11-11')).map((c) => c.num)).toEqual(list.map((c) => c.num));
		expect([b.lawId, b.num]).toEqual([next.lawId, next.num]);
	});
});

test('基準2：どれだけ変わっていないかは、法令のページの条と同じ日を持つ', async () => {
	const today = '2026-11-10';
	const want = await expected(today);
	const got = await todayCandidates(db, today);
	expect(got.map((c) => ({ lastAmended: c.lastAmended, enacted: c.enacted, text: c.text }))).toEqual(
		want.map((c) => ({ lastAmended: c.lastAmended, enacted: c.enacted, text: c.text }))
	);
	const a = (await todayArticle(db, today))!;
	expect(a.lawTitle).toBe((await lawPage(db, a.lawId))!.law.title);
	expect(a.label).toMatch(/^第\d+条/);
});
