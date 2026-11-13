// Issue #165：本文の「特商法9条」を条へのリンクにする（受入基準は Issue #198 の「#165」の節の基準1・2）
// 本文から候補を抜き出し（lawRefNames）、DB で引いた法令名と条（lawRefIndex）を使って、文字とリンクの並びにする（linkLawRefs）
import { expect, test } from 'vitest';
import { lawRefIndex, lawRefNames, linkLawRefs } from './refs';

const TOKUSHOHO = '351AC0000000057';
const SHOHISHA = '412AC0000000061';

test('基準1：本文の「特商法9条」「消費者契約法第4条第2項」「特定商取引に関する法律第九条の二」が、その条へのリンクになる', () => {
	const texts = ['定期購入の解約は、特商法9条のクーリング・オフとは別ですか。', '消費者契約法第4条第2項で取り消せます。', '（特定商取引に関する法律第九条の二）'];
	// サーバーで引く名前の候補に、正式名と通称が入る
	const names = lawRefNames(texts);
	for (const name of ['特商法', '消費者契約法', '特定商取引に関する法律']) expect(names).toContain(name);

	// DB で引けた名前（正式名・e-Gov の略称）と、ある条。通称（特商法）は aliases.ts から足す
	const index = lawRefIndex(
		[
			{ name: '特定商取引に関する法律', lawId: TOKUSHOHO },
			{ name: '特定商取引法', lawId: TOKUSHOHO },
			{ name: '消費者契約法', lawId: SHOHISHA }
		],
		[
			{ lawId: TOKUSHOHO, num: '9' },
			{ lawId: TOKUSHOHO, num: '9_2' },
			{ lawId: SHOHISHA, num: '4' }
		]
	);

	expect(linkLawRefs(texts[0], index)).toEqual([
		{ text: '定期購入の解約は、' },
		{ text: '特商法9条', href: `/hourei/${TOKUSHOHO}/9` },
		{ text: 'のクーリング・オフとは別ですか。' }
	]);
	// 項のアンカーはまだないので、条までをリンクにする
	expect(linkLawRefs(texts[1], index)).toEqual([
		{ text: '消費者契約法第4条', href: `/hourei/${SHOHISHA}/4` },
		{ text: '第2項で取り消せます。' }
	]);
	// 漢数字と「条の二」
	expect(linkLawRefs(texts[2], index)).toEqual([
		{ text: '（' },
		{ text: '特定商取引に関する法律第九条の二', href: `/hourei/${TOKUSHOHO}/9_2` },
		{ text: '）' }
	]);
	// 「第」はあってもなくてもよい。全角の数字、e-Gov の略称、1つの本文に2つ
	expect(linkLawRefs('特商法第９条と特定商取引法9条の2', index)).toEqual([
		{ text: '特商法第９条', href: `/hourei/${TOKUSHOHO}/9` },
		{ text: 'と' },
		{ text: '特定商取引法9条の2', href: `/hourei/${TOKUSHOHO}/9_2` }
	]);
	// 法令名の前に句読点のない文が続いていても、名前は条の番号の直前で探す
	expect(linkLawRefs('これは特商法9条の話', index)).toEqual([{ text: 'これは' }, { text: '特商法9条', href: `/hourei/${TOKUSHOHO}/9` }, { text: 'の話' }]);
});

test('基準2：ない法令名・ない条・ぶつかる略称は、リンクにしない', () => {
	const index = lawRefIndex(
		[
			{ name: '消費者契約法', lawId: SHOHISHA },
			// 2つの法律が同じ略称を持つ
			{ name: '同名法', lawId: 'LAW_A' },
			{ name: '同名法', lawId: 'LAW_B' },
			// 通称（aliases.ts の「特商法」）が、ほかの法律の略称とぶつかる
			{ name: '特商法', lawId: 'OTHER_LAW' }
		],
		[
			{ lawId: SHOHISHA, num: '4' },
			{ lawId: 'LAW_A', num: '1' },
			{ lawId: 'LAW_B', num: '1' },
			{ lawId: TOKUSHOHO, num: '9' },
			{ lawId: 'OTHER_LAW', num: '9' }
		]
	);
	const plain = (text: string) => expect(linkLawRefs(text, index)).toEqual([{ text }]);
	// ない法令名
	plain('架空取引法9条によれば');
	plain('9条だけでは法令がわからない');
	// ない条
	plain('消費者契約法第999条');
	plain('消費者契約法第4条の2');
	// ぶつかる略称
	plain('同名法1条');
	plain('特商法9条');
	// 同じ法律に正式名と略称の両方で当たるのは、ぶつからない
	const same = lawRefIndex(
		[
			{ name: '消費者契約法', lawId: SHOHISHA },
			{ name: '消契法', lawId: SHOHISHA }
		],
		[{ lawId: SHOHISHA, num: '4' }]
	);
	expect(linkLawRefs('消契法4条', same)).toEqual([{ text: '消契法4条', href: `/hourei/${SHOHISHA}/4` }]);
	// 何も引けていなければ、そのまま
	expect(linkLawRefs('特商法9条', lawRefIndex([], []))).toEqual([{ text: '特商法9条' }]);
});
