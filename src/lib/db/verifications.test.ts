// Issue #157：認証の書き込み（設計書 docs/spec/157.md の 3）。画面は e2e/ninsho.spec.ts
import { expect, test } from 'vitest';
import { writeGrant } from '../server/verifications';
import { openMemoryDb } from './memory';

const jst = (s: string) => Date.parse(`${s}+09:00`);

test('同じミリ秒に2人の運営が付けても、有効な認証と記録は1つずつ（書けなかったほうは記録しない）', async () => {
	const { sqlite, db } = openMemoryDb();
	sqlite.exec(
		"INSERT INTO user (id, name, email, created_at, updated_at) VALUES ('p', '参加者100001', 'p@test.invalid', 0, 0), ('op1', '運営1', 'o1@test.invalid', 0, 0), ('op2', '運営2', 'o2@test.invalid', 0, 0)"
	);
	const now = jst('2036-04-03T09:00:00');
	const first = await writeGrant(db, { userId: 'p', kind: 'legislator', name: '試験 太郎', field: null }, 'op1', now, 'op-a');
	const second = await writeGrant(db, { userId: 'p', kind: 'expert', name: '大学教授', field: '民法' }, 'op2', now, 'op-b');
	expect([first, second]).toEqual([true, false]);
	expect(sqlite.prepare('SELECT kind, display_name, field FROM user_verifications').all()).toEqual([{ kind: 'legislator', display_name: '試験 太郎', field: null }]);
	expect(sqlite.prepare('SELECT action, kind, display_name, actor_user_id FROM user_verification_logs').all()).toEqual([
		{ action: 'grant', kind: 'legislator', display_name: '試験 太郎', actor_user_id: 'op1' }
	]);
});
