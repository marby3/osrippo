// アクセス元の IP（設計書 docs/spec/25.md 決めたこと9）。そのまま保存せず、秘密の値を使ったハッシュにする

/** IPv6 を8つの16ビットの数に展開する。形が違えば null */
function expandIpv6(ip: string): number[] | null {
	let text = ip.toLowerCase();
	// 末尾が IPv4 の書き方（::ffff:203.0.113.7）なら、2つの16ビットに直す
	const v4 = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
	if (v4) {
		const [a, b, c, d] = v4.slice(1).map(Number);
		text = text.slice(0, v4.index) + `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
	}
	const halves = text.split('::');
	if (halves.length > 2) return null;
	const head = halves[0] ? halves[0].split(':') : [];
	const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
	const missing = 8 - head.length - tail.length;
	if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
	const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill('0'), ...tail];
	if (!groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null;
	return groups.map((g) => parseInt(g, 16));
}

const hex4 = (n: number) => n.toString(16).padStart(4, '0');

/** IPv4 はそのまま、IPv4 を写した IPv6（::ffff:）は IPv4 に、ほかの IPv6 は先頭の /64 にそろえる */
export function normalizeIp(raw: string): string {
	const ip = raw.trim().replace(/%.*$/, '');
	if (!ip.includes(':')) return ip;
	const g = expandIpv6(ip);
	if (!g) return ip.toLowerCase();
	if (g.slice(0, 5).every((n) => n === 0) && g[5] === 0xffff) {
		return [g[6] >> 8, g[6] & 0xff, g[7] >> 8, g[7] & 0xff].join('.');
	}
	return `${g.slice(0, 4).map(hex4).join(':')}::/64`;
}

/** HMAC-SHA256(secret, そろえた IP) の16進 */
export async function hashIp(secret: string, ip: string): Promise<string> {
	const enc = new TextEncoder();
	const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
	const mac = await crypto.subtle.sign('HMAC', key, enc.encode(normalizeIp(ip)));
	return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
