// 2つの版の条を、同じ内部IDどうしで比べる。DB にも画面にも触れない
import { diffChars } from 'diff';
import { articleText, compareNum } from './display';

type ArticleTree = Parameters<typeof articleText>[0] & { id: number; num: string; label: string };

export type DiffPart = { value: string; added?: boolean; removed?: boolean };

/** 変わった条だけを num の順に返す。丸ごと入った条・なくなった条も、本文全体を追加・削除として返す */
export function compareArticles(before: ArticleTree[], after: ArticleTree[]) {
	const old = new Map(before.map((a) => [a.id, a]));
	const now = new Map(after.map((a) => [a.id, a]));
	return [...new Set([...old.keys(), ...now.keys()])]
		.map((id) => {
			const [b, a] = [old.get(id), now.get(id)];
			const [bt, at] = [b && articleText(b), a && articleText(a)];
			if (bt === at && b?.num === a?.num) return undefined;
			const parts: DiffPart[] =
				bt === undefined
					? [{ value: at!, added: true }]
					: at === undefined
						? [{ value: bt, removed: true }]
						: diffChars(bt, at).map(({ value, added, removed }) => ({ value, added, removed }));
			return {
				num: (a ?? b)!.num,
				label: (a ?? b)!.label,
				beforeLabel: b && a && b.num !== a.num ? b.label : null,
				kind: !b ? ('added' as const) : !a ? ('removed' as const) : ('changed' as const),
				parts
			};
		})
		.filter((c) => c !== undefined)
		.sort((x, y) => compareNum(x.num, y.num));
}
