// Issue #199：招待コードの使い切り（設計書 docs/spec/199.md の 3）。画面は e2e/shotai.spec.ts
import { expect, test } from 'vitest';
import { useInvite } from '../server/invites';
import { openMemoryDb } from './memory';

test('基準3：同じコードで使用済みにする関数を2回呼ぶと、1回だけ通る', async () => {
	const { sqlite, db } = openMemoryDb();
	sqlite.exec("INSERT INTO user (id, name, email, created_at, updated_at) VALUES ('op', '運営1', 'o@test.invalid', 0, 0)");
	sqlite.exec("INSERT INTO invites (code, created_by, created_at) VALUES ('ABCDEFGHJKLM', 'op', 0)");
	const results = await Promise.all([useInvite(db, 'ABCDEFGHJKLM', 1000), useInvite(db, 'ABCDEFGHJKLM', 1001)]);
	expect(results.filter(Boolean)).toHaveLength(1);
	expect(await useInvite(db, 'ABCDEFGHJKLM', 1002)).toBe(false);
	const row = sqlite.prepare("SELECT used_at FROM invites WHERE code = 'ABCDEFGHJKLM'").get() as { used_at: number };
	expect([1000, 1001]).toContain(row.used_at);
});
