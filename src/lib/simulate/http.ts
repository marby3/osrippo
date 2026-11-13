// シミュレーションの HTTP（Issue #194）。返ってきた 5xx を数え、1件でもあれば終了コードを1にする（受入基準2）
export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export function createRecorder(fetchImpl: Fetch) {
	let errors = 0;
	return {
		async request(url: string, init?: RequestInit): Promise<Response> {
			const res = await fetchImpl(url, init);
			if (res.status >= 500) errors += 1;
			return res;
		},
		http5xx: () => errors,
		exitCode: (): 0 | 1 => (errors > 0 ? 1 : 0)
	};
}

export type Recorder = ReturnType<typeof createRecorder>;
