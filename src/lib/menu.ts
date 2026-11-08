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

/** タブの一覧そのもの（パンくずを出さないページ） */
export const isTabTop = (pathname: string) => TABS.some((t) => t.href === pathname);

/**
 * IF世界の帯を出すページ（ルートの id）。帯はメニューより上に出す（案 SpResult）ので、ページではなく全体の枠で出す。
 * IF世界のページを足したら、ここにも足す
 */
const IF_ROUTES = new Set(['/if/hourei/[lawId]', '/if/hourei/[lawId]/torikomi', '/saiketsu/[id]/kekka', '/tsuchi']);

export const hasIfBand = (routeId: string | null) => routeId !== null && IF_ROUTES.has(routeId);
