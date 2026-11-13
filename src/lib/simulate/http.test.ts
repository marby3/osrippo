// Issue #194 受入基準2：シミュレーションのあいだに 5xx が1件でも返ったら、終了コード1で終わる
import { describe, expect, it } from 'vitest';
import { createRecorder } from './http';

/** 決めた順に状態を返す fetch */
const fakeFetch = (statuses: number[]) => {
	const queue = [...statuses];
	return async () => new Response(null, { status: queue.shift() ?? 200 });
};

describe('createRecorder', () => {
	it('返ってきた 5xx を数え、1件でもあれば終了コードを1にする。4xx と 3xx は数えない', async () => {
		const ok = createRecorder(fakeFetch([200, 303, 400, 409, 429]));
		for (let i = 0; i < 5; i++) await ok.request('http://localhost:4173/');
		expect(ok.http5xx()).toBe(0);
		expect(ok.exitCode()).toBe(0);

		const bad = createRecorder(fakeFetch([200, 500, 303, 503]));
		for (let i = 0; i < 4; i++) await bad.request('http://localhost:4173/');
		expect(bad.http5xx()).toBe(2);
		expect(bad.exitCode()).toBe(1);
	});
});
