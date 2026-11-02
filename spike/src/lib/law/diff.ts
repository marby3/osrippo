// 2時点の条文を、内部IDで突き合わせて文字単位の差分にする
import { diffChars } from 'diff';

export type Seg = { kind: 'same' | 'add' | 'del'; text: string };
export type UnitRow = { provision_id: string; unit_id: string; ord: number; path: string; label: string; text: string };
export type ProvisionRow = { provision_id: string; ord: number; key: string; kind: string; title: string; caption: string; deleted: number };

export type UnitDiff = { unitId: string; label: string; status: 'same' | 'changed' | 'added' | 'removed'; segs: Seg[] };
export type ProvisionDiff = {
	provisionId: string;
	title: string;
	caption: string;
	kind: string;
	status: 'same' | 'changed' | 'added' | 'removed' | 'deleted';
	/** 条番号が変わったとき、前の版での条番号 */
	movedFrom?: string;
	units: UnitDiff[];
};

function segs(a: string, b: string): Seg[] {
	return diffChars(a, b).map((p) => ({ kind: p.added ? 'add' : p.removed ? 'del' : 'same', text: p.value }));
}

export function diffLaw(
	from: { provisions: ProvisionRow[]; units: UnitRow[] },
	to: { provisions: ProvisionRow[]; units: UnitRow[] }
): ProvisionDiff[] {
	const group = (us: UnitRow[]) => {
		const m = new Map<string, UnitRow[]>();
		for (const u of us) m.set(u.provision_id, [...(m.get(u.provision_id) ?? []), u]);
		return m;
	};
	const fu = group(from.units);
	const tu = group(to.units);
	const fp = new Map(from.provisions.map((p) => [p.provision_id, p]));
	const out: ProvisionDiff[] = [];
	const seen = new Set<string>();
	for (const p of to.provisions) {
		seen.add(p.provision_id);
		const before = fp.get(p.provision_id);
		const a = fu.get(p.provision_id) ?? [];
		const b = tu.get(p.provision_id) ?? [];
		const aById = new Map(a.map((u) => [u.unit_id, u]));
		const units: UnitDiff[] = [];
		for (const u of b) {
			const old = aById.get(u.unit_id);
			aById.delete(u.unit_id);
			if (!old) units.push({ unitId: u.unit_id, label: u.label, status: 'added', segs: [{ kind: 'add', text: u.text }] });
			else if (old.text === u.text) units.push({ unitId: u.unit_id, label: u.label, status: 'same', segs: [{ kind: 'same', text: u.text }] });
			else units.push({ unitId: u.unit_id, label: u.label, status: 'changed', segs: segs(old.text, u.text) });
		}
		// 消えた項・号は、前の版での位置の近くに出す
		for (const old of aById.values()) {
			const at = units.findIndex((x) => x.unitId === b.find((u) => u.ord > old.ord)?.unit_id);
			const row: UnitDiff = { unitId: old.unit_id, label: old.label, status: 'removed', segs: [{ kind: 'del', text: old.text }] };
			if (at < 0) units.push(row);
			else units.splice(at, 0, row);
		}
		const status: ProvisionDiff['status'] = !before
			? 'added'
			: p.deleted && !before.deleted
				? 'deleted'
				: units.some((u) => u.status !== 'same') || before.caption !== p.caption
					? 'changed'
					: 'same';
		out.push({
			provisionId: p.provision_id,
			title: p.title,
			caption: before && before.caption !== p.caption ? '' : p.caption,
			kind: p.kind,
			status,
			movedFrom: before && before.title !== p.title ? before.title : undefined,
			units
		});
	}
	for (const p of from.provisions) {
		if (seen.has(p.provision_id)) continue;
		out.push({
			provisionId: p.provision_id,
			title: p.title,
			caption: p.caption,
			kind: p.kind,
			status: 'removed',
			units: (fu.get(p.provision_id) ?? []).map((u) => ({ unitId: u.unit_id, label: u.label, status: 'removed', segs: [{ kind: 'del', text: u.text }] }))
		});
	}
	return out;
}
