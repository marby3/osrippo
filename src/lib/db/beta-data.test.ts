// Issue #201 基準2（#198 の「負荷試験」）：β の規模のデータ（参加者100人、課題50件、法案10本と票）を作る SQL を、
// 法令を取り込んだメモリの DB に流して、作った件数を確かめる。消す SQL で β の行だけが消えることも確かめる
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { openMemoryDb } from './memory';
import { seedStatements, TARGET_LAWS } from './seed';
import { BETA_COUNT_SQL, BETA_DELETE_STATEMENTS, betaData } from './beta-data';
import { sessionAt } from '../domain/session';
import { parseQuery } from '../domain/search';
import { tallyVotes } from '../server/votes';
import { searchIssues } from '../server/search';

const root = new URL('../../../', import.meta.url);
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`tests/fixtures/egov/${name}.json`, root), 'utf8'));
const jst = (s: string) => Date.parse(`${s}+09:00`);

test('基準2：β の規模のデータを作り、件数を確かめられる。消す SQL で β の行だけが消える', async () => {
	// 採決の週（いまの会期の票もある）と、会期の始まりの直後（いまの会期の票はまだない）
	for (const now of [jst('2030-05-24T12:00:00'), jst('2030-06-01T00:30:00')]) {
		const { sqlite, db } = openMemoryDb();
		for (const sql of seedStatements(TARGET_LAWS, fixture)) sqlite.exec(sql);
		// もとからある利用者と課題（ID がぶつからず、消す SQL で消えない）
		sqlite.exec("INSERT INTO user (id, name, email, created_at, updated_at) VALUES ('real-1', '参加者000001', 'google-1@users.invalid', 0, 0)");
		sqlite.exec("INSERT INTO issues (user_id, title, affected, example, created_at) VALUES ('real-1', 'もとからある課題', 'a', 'e', 0)");

		const data = betaData(now);
		for (const sql of data.statements) sqlite.exec(sql);

		const counts = sqlite.prepare(BETA_COUNT_SQL).get() as Record<string, number>;
		expect(counts).toEqual(data.expected);
		// β の規模（#190 決めたこと6）
		expect(counts.users).toBe(100);
		expect(counts.issues).toBe(50);
		expect(counts.bills).toBe(10);
		expect(counts.billChanges).toBe(10);
		expect(counts.issueSearch).toBeGreaterThanOrEqual(50);
		expect(counts.solutions).toBeGreaterThan(0);
		expect(counts.issueSupports).toBeGreaterThan(0);
		expect(counts.billSupports).toBeGreaterThan(0);
		expect(counts.previousVotes).toBeGreaterThan(0);
		expect(counts.billResults).toBe(5);
		const current = sessionAt(now, null);
		if (now >= current.voteAt) expect(counts.currentVotes).toBeGreaterThan(0);
		else expect(counts.currentVotes).toBe(0);

		// 時刻は「いま」より後にならない
		const latest = sqlite
			.prepare(
				`SELECT max(t) AS t FROM (
					SELECT max(created_at) AS t FROM issues UNION ALL SELECT max(created_at) FROM solutions UNION ALL SELECT max(created_at) FROM issue_supports
					UNION ALL SELECT max(proposed_at) FROM bills UNION ALL SELECT max(updated_at) FROM votes UNION ALL SELECT max(created_at) FROM actions
					UNION ALL SELECT max(updated_at) FROM stances UNION ALL SELECT max(settled_at) FROM bill_results)`
			)
			.get() as { t: number };
		expect(latest.t).toBeLessThanOrEqual(now);

		// 前の会期の結果の行は、本体の数え方（数えた票）と同じ数
		const previous = sessionAt(current.startsAt - 1, null);
		const results = sqlite.prepare('SELECT bill_id, outcome, yes, no, abstain FROM bill_results WHERE session_key = ? ORDER BY bill_id').all(previous.key) as {
			bill_id: number;
			outcome: string;
			yes: number;
			no: number;
			abstain: number;
		}[];
		expect(results).toHaveLength(5);
		for (const r of results) {
			const { counted, reference } = await tallyVotes(db, previous, r.bill_id);
			expect(counted).toEqual({ yes: r.yes, no: r.no, abstain: r.abstain });
			expect(reference).toEqual({ yes: 0, no: 0, abstain: 0 });
			// IF世界の条文を変えない（可決にしない）
			expect(r.outcome).toBe('rejected');
		}

		// 課題は全文検索で見つかる（負荷試験の検索の言葉）
		const words = parseQuery('解約');
		if (!words.ok) throw new Error('検索の言葉');
		expect((await searchIssues(db, words.words, 20)).total).toBeGreaterThan(0);

		for (const sql of BETA_DELETE_STATEMENTS) sqlite.exec(sql);
		const left = sqlite.prepare(BETA_COUNT_SQL).get() as Record<string, number>;
		expect(Object.values(left).every((n) => n === 0)).toBe(true);
		expect(sqlite.prepare("SELECT count(*) AS n FROM user WHERE id = 'real-1'").get()).toEqual({ n: 1 });
		expect(sqlite.prepare("SELECT count(*) AS n FROM issues WHERE user_id = 'real-1'").get()).toEqual({ n: 1 });
		expect(sqlite.prepare('SELECT count(*) AS n FROM stance_log').get()).toEqual({ n: 0 });
		expect(sqlite.prepare("SELECT count(*) AS n FROM search_trigram WHERE kind <> 'provision'").get()).toEqual({ n: 0 });
	}
}, 120_000);
