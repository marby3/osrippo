// 条番号とは別の内部IDで版を追えるかの見通し用。
// 前の版と次の版で、同じ条番号・同じ位置を優先し、合わなければ本文の似ている度合いで対応を探す。
import type { Provision } from './parse';

export type Ided<T> = T & { id: string };
export type IdedProvision = Omit<Ided<Provision>, 'units'> & { units: Ided<Provision['units'][number]>[] };

export type Move = { level: 'provision' | 'unit'; id: string; from: string; to: string; similarity: number };

/** 文字bigramのDice係数（0〜1）。長い条文でもO(n)で済む */
export function similarity(a: string, b: string): number {
	if (a === b) return 1;
	if (a.length < 2 || b.length < 2) return 0;
	const grams = new Map<string, number>();
	for (let i = 0; i < a.length - 1; i++) {
		const g = a.slice(i, i + 2);
		grams.set(g, (grams.get(g) ?? 0) + 1);
	}
	let hit = 0;
	for (let i = 0; i < b.length - 1; i++) {
		const g = b.slice(i, i + 2);
		const c = grams.get(g);
		if (c) {
			hit++;
			grams.set(g, c - 1);
		}
	}
	return (2 * hit) / (a.length - 1 + (b.length - 1));
}

const SAME_PLACE = 0.5;
const MOVED = 0.75;

function match<T>(
	prev: (T & { id: string })[],
	next: T[],
	place: (x: T) => string,
	text: (x: T) => string | null,
	newId: () => string,
	sameKind: (a: T, b: T) => boolean = () => true
): { ids: string[]; moves: { id: string; from: string; to: string; similarity: number }[] } {
	const byPlace = new Map(prev.map((p) => [place(p), p]));
	const used = new Set<string>();
	const ids: (string | null)[] = next.map((n) => {
		const p = byPlace.get(place(n));
		// 本文のない側（削除された条）は、同じ位置なら同じものとみなす
		const [a, b] = p ? [text(p), text(n)] : [null, null];
		if (p && (a === null || b === null || similarity(a, b) >= SAME_PLACE)) {
			used.add(p.id);
			return p.id;
		}
		return null;
	});
	const moves: { id: string; from: string; to: string; similarity: number }[] = [];
	next.forEach((n, i) => {
		const t = text(n);
		if (ids[i]) return;
		if (t === null) return void (ids[i] = newId());
		let best: (T & { id: string }) | null = null;
		let bestSim = MOVED;
		for (const p of prev) {
			const pt = text(p);
			if (used.has(p.id) || pt === null || !sameKind(p, n)) continue;
			const s = similarity(pt, t);
			if (s >= bestSim) [best, bestSim] = [p, s];
		}
		if (best) {
			used.add(best.id);
			ids[i] = best.id;
			moves.push({ id: best.id, from: place(best), to: place(n), similarity: Math.round(bestSim * 100) / 100 });
		} else ids[i] = newId();
	});
	return { ids: ids as string[], moves };
}

let seq = 0;
const nextId = () => `u${(++seq).toString(36)}`;

export function assignIds(prev: IdedProvision[] | null, next: Provision[]): { provisions: IdedProvision[]; moves: Move[] } {
	const body = (p: Provision) => (p.deleted ? null : p.units.map((u) => u.text).join(''));
	if (!prev) {
		return {
			provisions: next.map((p) => ({ ...p, id: nextId(), units: p.units.map((u) => ({ ...u, id: nextId() })) })),
			moves: []
		};
	}
	const moves: Move[] = [];
	const pm = match(prev, next, (p) => p.key, body, nextId, (a, b) => a.kind === b.kind);
	pm.moves.forEach((m) => moves.push({ level: 'provision', ...m }));
	const provisions = next.map((p, i) => {
		const id = pm.ids[i];
		const before = prev.find((x) => x.id === id);
		// 号が項に化けるような、階層をまたぐ対応はとらない
		const shape = (u: { path: string }) => u.path.replace(/\d+/g, '');
		const um = match(before?.units ?? [], p.units, (u) => u.path, (u) => u.text, nextId, (a, b) => shape(a) === shape(b));
		um.moves.forEach((m) => moves.push({ level: 'unit', ...m, from: `${before?.key}/${m.from}`, to: `${p.key}/${m.to}` }));
		return { ...p, id, units: p.units.map((u, j) => ({ ...u, id: um.ids[j] })) };
	});
	return { provisions, moves };
}
