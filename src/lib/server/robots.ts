// ステージングを検索に載せない（Issue #156）。wrangler.jsonc の env.staging の vars で NOINDEX を "1" にする。本番には置かない
const VALUE = 'noindex, nofollow';

/** NOINDEX が "1" のときだけ、応答に X-Robots-Tag を付ける。ヘッダーを変えられない応答（Response.redirect など）は作り直す */
export function withNoindex(response: Response, noindex: string | undefined): Response {
	if (noindex !== '1') return response;
	try {
		response.headers.set('x-robots-tag', VALUE);
		return response;
	} catch {
		const copy = new Response(response.body, response);
		copy.headers.set('x-robots-tag', VALUE);
		return copy;
	}
}
