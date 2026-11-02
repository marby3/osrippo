// ログインの決まり（設計書 docs/spec/23.md）。DB にも画面にも触れない

/**
 * ログインのあとに戻るパス。自サイトの中だけを許し、それ以外は "/"（決めたこと6）。
 * next を使う場所では、どこでもサーバー側でこれを通す
 */
export function safeNext(next: string | null | undefined, origin: string): string {
	if (!next || !next.startsWith('/') || /[\u0000-\u001f\u007f]/.test(next)) return '/';
	const url = new URL(next, origin);
	if (url.origin !== new URL(origin).origin) return '/';
	// 解決で . や .. が消えて // や /\ が現れたもの（/.//evil.example）は、返すと外への URL になる
	if (/^[/\\]{2}/.test(url.pathname)) return '/';
	return url.pathname + url.search + url.hash;
}

export type Provider = 'google' | 'line';

/**
 * 提供元のプロフィールから利用者を作る（決めたこと1・2・4）。
 * 名前・メール・画像は使わない。メールは提供元ごとに分ける。表示名は作るときに pickDisplayName で振る
 */
export function profileToUser<P extends { sub: string }>(provider: Provider, profile: P) {
	// Better Auth は提供元の値のあとにこれを重ねるので、image を undefined にすれば提供元の画像は残らない
	return { name: '参加者', email: `${provider}-${profile.sub}@users.invalid`, image: undefined };
}

/** 「参加者」＋6桁（100000〜999999）の表示名。既にあれば5回まで振り直す */
export async function pickDisplayName(
	taken: (name: string) => Promise<boolean>,
	random: () => number = Math.random
): Promise<string> {
	let name = '';
	for (let i = 0; i < 5; i++) {
		name = `参加者${100000 + Math.floor(random() * 900000)}`;
		if (!(await taken(name))) return name;
	}
	// 5回とも重なったら最後の名前のまま。user.name の一意の索引が止める
	return name;
}

/** 提供元のトークン類を保存しない（決めたこと4） */
export function withoutTokens<T extends object>(account: T): T {
	return {
		...account,
		accessToken: null,
		refreshToken: null,
		idToken: null,
		accessTokenExpiresAt: null,
		refreshTokenExpiresAt: null
	};
}
