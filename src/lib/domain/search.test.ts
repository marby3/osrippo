// Issue #38 全文検索：そろえ方、検索の言葉の判定（信頼の境界）、該当部分（設計書 docs/spec/38.md 決めたこと1・2・6）
import { expect, test } from 'vitest';
import { bigrams, normalizeText, parseQuery, snippet } from './search';

test('基準4：本文と言葉を同じ規則でそろえる（NFKC・小文字・記号と空白を除く）。bigram の組を作る', () => {
	expect(normalizeText('クーリング・オフ')).toBe('クーリングオフ');
	expect(normalizeText('ＥＴＣ カード\n更新！')).toBe('etcカード更新');
	expect(bigrams('クーリングオフ')).toEqual(['クー', 'ーリ', 'リン', 'ング', 'グオ', 'オフ']);
	expect(bigrams('あ')).toEqual([]);
});

test('信頼の境界：検索の言葉は2文字以上・5つまで・60字まで・制御文字なし。空なら探さない', () => {
	expect(parseQuery(null)).toEqual({ ok: true, words: [] });
	expect(parseQuery('   ')).toEqual({ ok: true, words: [] });
	expect(parseQuery(' クーリング・オフ　ETC ')).toEqual({
		ok: true,
		words: [
			{ raw: 'クーリング・オフ', norm: 'クーリングオフ' },
			{ raw: 'ETC', norm: 'etc' }
		]
	});
	expect(parseQuery('事業者 契約').ok).toBe(true);
	expect(parseQuery('あ'.repeat(60)).ok).toBe(true);
	expect(parseQuery('あ')).toEqual({ ok: false, error: 'short' });
	expect(parseQuery('契約 あ')).toEqual({ ok: false, error: 'short' });
	// 記号だけの言葉は、そろえると0文字
	expect(parseQuery('契約 !!')).toEqual({ ok: false, error: 'short' });
	expect(parseQuery('あ'.repeat(61))).toEqual({ ok: false, error: 'long' });
	expect(parseQuery('ああ いい うう ええ おお かか')).toEqual({ ok: false, error: 'long' });
	// そろえると長くなる文字（U+FDFA は空白を除いて15字になる。5つで75字）
	expect(parseQuery(String.fromCodePoint(0xfdfa).repeat(5))).toEqual({ ok: false, error: 'long' });
	expect(parseQuery('契約\u0007')).toEqual({ ok: false, error: 'control' });
	expect(parseQuery(`契約${String.fromCodePoint(0x202e)}`)).toEqual({ ok: false, error: 'control' });
});

test('基準2：該当部分は最初の言葉の前後を切り出し、当たった言葉に印を付ける（大文字・小文字は区別しない）', () => {
	const text = 'この法律は、販売業者がクーリング・オフの期間を書面で知らせることを定める。ETCの書面も同じとする。';
	const parts = snippet(text, [{ raw: 'クーリング・オフ', norm: 'クーリングオフ' }, { raw: 'etc', norm: 'etc' }]);
	expect(parts.filter((p) => p.mark).map((p) => p.text)).toEqual(['クーリング・オフ', 'ETC']);
	expect(parts.map((p) => p.text).join('')).toContain('販売業者がクーリング・オフ');
	// 元の文で見つからないとき（記号をはさむ書き方）は頭から
	const plain = snippet('クーリング・オフの期間は八日とする。', [{ raw: 'クーリングオフ', norm: 'クーリングオフ' }]);
	expect(plain.map((p) => p.text).join('')).toBe('クーリング・オフの期間は八日とする。');
	expect(plain.some((p) => p.mark)).toBe(false);
	// 長い文は前後を「…」で切る
	const long = snippet('あ'.repeat(100) + '目印' + 'い'.repeat(100), [{ raw: '目印', norm: '目印' }]);
	const joined = long.map((p) => p.text).join('');
	expect(joined.startsWith('…')).toBe(true);
	expect(joined.endsWith('…')).toBe(true);
	expect([...joined].length).toBeLessThan(100);
});
