// Issue #156：ステージングを検索に載せない（基準2・4）。画面のテストのサーバーは NOINDEX を渡さないので、本番と同じくヘッダーがない
import { expect, test } from '@playwright/test';

test('基準2：NOINDEX のないサーバーの応答には X-Robots-Tag がない（本番は今のまま）', async ({ request }) => {
	for (const path of ['/', '/kadai', '/no-such-page']) {
		const res = await request.get(path);
		expect(res.headers()['x-robots-tag'], path).toBeUndefined();
	}
});
