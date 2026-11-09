// 全体のメニューのタブと、ページがどのタブに属するか（Issue #85）

export type Tab = 'home' | 'kadai' | 'houan' | 'saiketsu' | 'hourei';

export const TABS: { key: Tab; href: string }[] = [
	{ key: 'home', href: '/' },
	{ key: 'kadai', href: '/kadai' },
	{ key: 'houan', href: '/houan' },
	{ key: 'saiketsu', href: '/saiketsu' },
	{ key: 'hourei', href: '/hourei' }
];

const under = (pathname: string, base: string) => pathname === base || pathname.startsWith(`${base}/`);

/** ページが属するタブ。IF世界の法令は「法律」。検索・通知・わたしの記録などはどれにも属さない */
export function tabOf(pathname: string): Tab | null {
	if (pathname === '/') return 'home';
	if (under(pathname, '/if/hourei')) return 'hourei';
	return TABS.find((t) => t.key !== 'home' && under(pathname, t.href))?.key ?? null;
}

/**
 * スマホで下のタブを隠すページ（Tokens「スマホで入力・投票中は下のメニューを隠す」、Issue #118）。
 * 書く画面（パスの最後が kaku）と投票の画面
 */
export function hidesTabsOnSp(routeId: string | null): boolean {
	if (routeId === null) return false;
	return routeId.endsWith('/kaku') || routeId === '/saiketsu/[id]';
}
