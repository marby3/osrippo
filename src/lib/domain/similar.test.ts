// Issue #30 基準3：似ているかの決め方（設計書 docs/spec/30.md「似ている度合い」）
import { expect, test } from 'vitest';
import { rankSimilar, similarity } from './similar';

test('基準3：2文字ずつの組（平仮名だけの組を除く）の重なりで決め、共通2組以上・度合い0.2以上を高い順に3件まで', () => {
	const query = '駅前で自転車の走る場所がわからない';
	// 画面の案の例
	const candidates = [
		{ id: 1, title: '自転車で歩道を走っていい場所がわかりにくい', supports: 214 },
		{ id: 2, title: '引っ越しのたびに役所の窓口をいくつも回る', supports: 187 },
		{ id: 3, title: '古いマンションの建て替えが決まらない', supports: 96 },
		{ id: 4, title: '自転車専用の通行帯が途中で途切れる', supports: 58 },
		{ id: 5, title: '駅前の放置自転車で歩道が通りにくい', supports: 41 }
	];
	expect(rankSimilar(query, candidates).map((c) => c.id)).toEqual([1, 5]);

	// 平仮名だけの組は数えない（言い回しが同じだけでは似ていない）
	expect(similarity('料金がわからない', '解約方法がわからない')).toEqual({ common: 0, score: 0 });
	// 全角・半角、大文字・小文字、空白と記号はそろえる
	expect(similarity('ＥＴＣカード　更新！', 'etcカード更新').score).toBe(1);
	// 2文字に満たないもの
	expect(similarity('a', 'a')).toEqual({ common: 0, score: 0 });

	// 度合いが同じなら「わかる」の多い順、さらに同じなら新しい順（id の大きい順）。3件まで
	const same = [
		{ id: 10, title: '定期購入の解約', supports: 1 },
		{ id: 11, title: '定期購入の解約', supports: 5 },
		{ id: 12, title: '定期購入の解約', supports: 1 },
		{ id: 13, title: '定期購入の解約', supports: 0 }
	];
	expect(rankSimilar('定期購入の解約', same).map((c) => c.id)).toEqual([11, 12, 10]);
});
