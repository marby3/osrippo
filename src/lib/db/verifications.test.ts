// Issue #157：認証の書き込み（設計書 docs/spec/157.md の 3）。画面は e2e/ninsho.spec.ts
import { expect, test } from 'vitest';
import { changeVerification, writeGrant } from '../server/verifications';
import type { MemoryDb } from './memory';
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

test('付けた直後に別の運営が延ばしても、付けたほうには「書けた」と返す（印の上書きで結果を取り違えない）', async () => {
	const { sqlite, db } = openMemoryDb();
	sqlite.exec(
		"INSERT INTO user (id, name, email, created_at, updated_at) VALUES ('p', '参加者100002', 'p@test.invalid', 0, 0), ('op1', '運営1', 'o1@test.invalid', 0, 0), ('op2', '運営2', 'o2@test.invalid', 0, 0)"
	);
	const now = jst('2036-04-03T09:00:00');
	// 付与の batch が終わってから、結果を読むまでのあいだに、別の運営が延ばす
	const racing = Object.assign(Object.create(db), {
		batch: async (queries: Parameters<MemoryDb['batch']>[0]) => {
			const results = await db.batch(queries);
			expect(await changeVerification(db, 'renew', 'p', 'op2', now + 1)).toBe(true);
			return results;
		}
	}) as MemoryDb;
	expect(await writeGrant(racing, { userId: 'p', kind: 'legislator', name: '試験 太郎', field: null }, 'op1', now, 'op-a')).toBe(true);
	expect(sqlite.prepare('SELECT action FROM user_verification_logs ORDER BY id').all()).toEqual([{ action: 'grant' }, { action: 'renew' }]);
});
