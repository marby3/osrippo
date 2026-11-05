// Issue #74 基準1：DB の行の形を起点に続けても、一度に作った場合と同じ行になる（設計書 docs/spec/74.md 決めたこと3）
import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { BASELINE_DATE, buildHistory, extendHistory, parseLaw, type EgovNode } from './index';

const LAWS = ['337AC0000000134', '351AC0000000057', '412AC0000000061'];
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../../../../tests/fixtures/egov/${name}.json`, import.meta.url), 'utf8'));

function revisionsOf(lawId: string) {
	const all = [...fixture(`law_revisions_${lawId}`).revisions].reverse() as { law_revision_id: string; amendment_enforcement_date: string }[];
	const base = all.findLastIndex((r) => r.amendment_enforcement_date <= BASELINE_DATE);
	return {
		hasBaseline: base >= 0,
		revisions: all.slice(Math.max(base, 0)).map((r) => ({
			id: r.law_revision_id,
			articles: parseLaw((fixture(`law_data_${r.law_revision_id}`) as { law_full_text: EgovNode }).law_full_text)
		}))
	};
}

test.each(LAWS)('基準1：%s の全部の位置で、続きから作った履歴が一度に作った場合と同じ行になる', (lawId) => {
	const { hasBaseline, revisions } = revisionsOf(lawId);
	const whole = buildHistory(revisions, { hasBaseline, nextId: 1 });
	const seqOf = new Map(revisions.map((r, i) => [r.id, i]));
	const provisionOf = new Map(whole.provisions.map((p) => [p.id, p]));

	for (let k = 0; k < revisions.length - 1; k++) {
		const fromSeq = (v: { fromRevisionId: string }) => seqOf.get(v.fromRevisionId)!;
		const toSeq = (v: { toRevisionId: string | null }) => (v.toRevisionId === null ? Infinity : seqOf.get(v.toRevisionId)!);
		// DB の行の形（provisionsAt の戻り）。DB は行の順を約束しないので、逆にして渡す
		const rows = whole.versions
			.filter((v) => fromSeq(v) <= k && toSeq(v) > k)
			.map((v) => {
				const p = provisionOf.get(v.provisionId)!;
				return { id: p.id, kind: p.kind, parentId: p.parentId, num: v.num, caption: v.caption, text: v.text };
			})
			.reverse();
		const later = whole.versions.filter((v) => fromSeq(v) > k);
		const known = new Set(whole.versions.filter((v) => fromSeq(v) <= k).map((v) => v.provisionId));
		const nextId = Math.max(...known) + 1;

		const extended = extendHistory({ revisionId: revisions[k].id, rows }, revisions.slice(k + 1), { nextId });

		expect(extended.versions, `位置 ${k} の行`).toEqual(later);
		expect(extended.provisions, `位置 ${k} の内部ID`).toEqual(whole.provisions.filter((p) => !known.has(p.id)));
		expect(extended.nextId, `位置 ${k} の次の番号`).toBe(whole.nextId);
		// 起点の行のうち、あとの版で閉じたもの
		const closed = whole.versions.filter((v) => fromSeq(v) <= k && toSeq(v) > k && v.toRevisionId !== null);
		const sort = (a: { provisionId: number }, b: { provisionId: number }) => a.provisionId - b.provisionId;
		expect([...extended.closes].sort(sort), `位置 ${k} の閉じる行`).toEqual(closed.map((v) => ({ provisionId: v.provisionId, toRevisionId: v.toRevisionId })).sort(sort));
	}
}, 120_000);
