// Issue #201 基準2（#198 の「負荷試験」）：β の規模のデータ（参加者100人、課題50件、法案10本と票）を作る SQL を、
// 法令を取り込んだメモリの DB に流して、作った件数を確かめる。消す SQL で β の行だけが消えることも確かめる
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { openMemoryDb } from './memory';
import { seedStatements, TARGET_LAWS } from './seed';
import { betaCountSql, betaData, betaDeleteStatements } from './beta-data';
import { sessionAt } from '../domain/session';
import { tallyVotes } from '../server/votes';

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
		const realIssue = Number(sqlite.prepare("INSERT INTO issues (user_id, title, affected, example, created_at) VALUES ('real-1', 'もとからある課題', 'a', 'e', 0)").run().lastInsertRowid);
		// データを入れる前からある行：固定済みの今月の参加者の数、もとからある課題への通知と条への参照
		sqlite.prepare("INSERT INTO session_participants (committee_id, session_key, active_count, fixed_at) VALUES (1, 'old', 3, ?)").run(now - 1000);
		sqlite.prepare("INSERT INTO notifications (user_id, kind, target_id, ref_id, created_at) VALUES ('real-1', 'issue_hidden', ?, 0, 0)").run(realIssue);
		sqlite.prepare("INSERT INTO law_refs (kind, ref_id, law_id, num) VALUES ('issue', ?, '412AC0000000061', '4')").run(realIssue);

		const data = betaData(now);
		for (const sql of data.statements) sqlite.exec(sql);
		const count = () => sqlite.prepare(betaCountSql(now)).get() as Record<string, number>;

		const counts = count();
		expect(counts).toEqual(data.expected);
		// β の規模（#190 決めたこと6）と docs/load-test.md の表の数
		const current = sessionAt(now, null);
		const voting = now >= current.voteAt;
		expect(counts).toEqual({
			users: 100,
			issues: 50,
			issueSearch: 150,
			solutions: 100,
			solutionSearch: 100,
			issueSupports: 300,
			solutionReactions: 100,
			bills: 10,
			billChanges: 10,
			billSupports: 80,
			stances: 554,
			previousVotes: 277,
			currentVotes: voting ? 277 : 0,
			billResults: 5,
			// 課題50・解決策100・「わかる」300と100・起草と発議10ずつ・賛同80・票
			actions: 50 + 100 + 300 + 100 + 10 + 10 + 80 + 277 + (voting ? 277 : 0),
			sessionParticipants: 0,
			notifications: 0
		});

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

		// 課題と解決策は全文検索で見つかる（負荷試験の検索の言葉。2文字は bigram の表を引く。src/lib/server/search.ts）
		for (const kind of ['issue', 'solution']) {
			const found = sqlite.prepare(`SELECT count(DISTINCT ref_id) AS n FROM search_bigram WHERE kind = ? AND search_bigram MATCH '"解約"'`).get(kind) as { n: number };
			expect(found.n).toBeGreaterThan(0);
		}

		// 入れたあとで本体が作る行：いまの会期の今月の参加者の数（β の利用者を数えた）、β の法案の結果の通知（β の利用者とほかの人へ）、β の課題への条の参照
		const betaBill = (sqlite.prepare("SELECT id FROM bills WHERE user_id LIKE 'beta-%' LIMIT 1").get() as { id: number }).id;
		const betaIssue = (sqlite.prepare("SELECT id FROM issues WHERE user_id LIKE 'beta-%' LIMIT 1").get() as { id: number }).id;
		sqlite.prepare('INSERT INTO session_participants (committee_id, session_key, active_count, fixed_at) VALUES (1, ?, 100, ?)').run(current.key, now + 1000);
		sqlite.prepare("INSERT INTO notifications (user_id, kind, target_id, ref_id, created_at) VALUES ('real-1', 'bill_rejected', ?, 0, ?)").run(betaBill, now + 1000);
		sqlite.prepare("INSERT INTO notifications (user_id, kind, target_id, ref_id, created_at) VALUES ('beta-u001', 'bill_rejected', ?, 0, ?)").run(betaBill, now + 1000);
		sqlite.prepare("INSERT INTO law_refs (kind, ref_id, law_id, num) VALUES ('issue', ?, '412AC0000000061', '4')").run(betaIssue);
		expect(count()).toMatchObject({ sessionParticipants: 1, notifications: 2 });

		for (const sql of betaDeleteStatements(now)) sqlite.exec(sql);
		const left = count();
		expect(Object.values(left).every((n) => n === 0)).toBe(true);
		const n = (sql: string) => (sqlite.prepare(sql).get() as { n: number }).n;
		// β の行が残っていない（数える SQL に入れていない表も）
		expect(n("SELECT count(*) AS n FROM search_trigram WHERE kind <> 'provision'")).toBe(0);
		expect(n("SELECT count(*) AS n FROM search_bigram WHERE kind <> 'provision'")).toBe(0);
		expect(n('SELECT count(*) AS n FROM stance_log')).toBe(0);
		expect(n('SELECT count(*) AS n FROM bill_laws')).toBe(0);
		expect(n('SELECT count(*) AS n FROM bill_solutions')).toBe(0);
		// もとからある行は残る
		expect(n("SELECT count(*) AS n FROM user WHERE id = 'real-1'")).toBe(1);
		expect(n("SELECT count(*) AS n FROM issues WHERE user_id = 'real-1'")).toBe(1);
		expect(sqlite.prepare('SELECT session_key FROM session_participants').all()).toEqual([{ session_key: 'old' }]);
		expect(sqlite.prepare('SELECT kind, target_id FROM notifications').all()).toEqual([{ kind: 'issue_hidden', target_id: realIssue }]);
		expect(sqlite.prepare('SELECT ref_id FROM law_refs').all()).toEqual([{ ref_id: realIssue }]);
	}
}, 120_000);
