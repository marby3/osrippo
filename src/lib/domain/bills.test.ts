// Issue #45 基準3〜6：変更後の条文の読み取り、変更点の確かめ、法案の確かめ、正式名（設計書 docs/spec/45.md）
import { describe, expect, test } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { parseLaw, type Article } from './law';
import { articleBodyText, checkChanges, formalName, parseArticleBody, validateBill, type BillChange } from './bills';

const root = new URL('../../../', import.meta.url);
const dir = new URL('tests/fixtures/egov/', root);
const TARGET = ['337AC0000000134', '351AC0000000057', '412AC0000000061'];
/** 対象3法の取り込みデータのすべての版（いまの版を含む） */
const lawData = readdirSync(dir).filter((f) => TARGET.some((l) => f.startsWith(`law_data_${l}`)));
const articlesOf = (f: string) => parseLaw(JSON.parse(readFileSync(new URL(f, dir), 'utf8')).law_full_text);

describe('基準3：変更後の条文の読み取り', () => {
	test('対象3法のすべての版のすべての条で、項と号に戻る', () => {
		let count = 0;
		for (const f of lawData) {
			for (const a of articlesOf(f)) {
				const parsed = parseArticleBody(articleBodyText(a.paragraphs));
				expect(parsed, `${f} 第${a.num}条`).toEqual({ ok: true, paragraphs: a.paragraphs });
				count++;
			}
		}
		// 取り込みデータの全部の版を回したこと（2026-11-04 の時点で 4919 条）
		expect(count).toBeGreaterThan(1000);
	});

	test('形が違えば、何行目がどう違うかを返す', () => {
		expect(parseArticleBody('第1項の本文\n2　第2項\n4　第4項')).toEqual({ ok: false, line: 3, error: 'paragraphOrder' });
		expect(parseArticleBody('本文\n二　二号\n一　一号')).toEqual({ ok: false, line: 3, error: 'itemOrder' });
		expect(parseArticleBody('\n\n')).toEqual({ ok: false, line: 1, error: 'required' });
	});
});

describe('信頼の境界：変更後の条文の欄', () => {
	test('長すぎる、制御文字、全角の数字の項', () => {
		expect(parseArticleBody('あ'.repeat(10001))).toEqual({ ok: false, line: 1, error: 'tooLong' });
		expect(parseArticleBody('あ'.repeat(10000)).ok).toBe(true);
		expect(parseArticleBody('本文\n2　a\u0007b')).toEqual({ ok: false, line: 2, error: 'control' });
		expect(parseArticleBody('本文\na\u202eb')).toEqual({ ok: false, line: 2, error: 'control' });
		// 全角の「２」は項の行にしない（前の本文の続き）
		expect(parseArticleBody('本文\n２　続き')).toEqual({ ok: true, paragraphs: [{ num: '1', text: '本文\n２　続き', items: [] }] });
		// 1行目は号の形でも第1項の本文
		expect(parseArticleBody('一　本文')).toEqual({ ok: true, paragraphs: [{ num: '1', text: '一　本文', items: [] }] });
		// \r\n はそろえ、空の行は無視する
		expect(parseArticleBody('本文\r\n\r\n一　号\r\n十二の二　号')).toEqual({
			ok: true,
			paragraphs: [{ num: '1', text: '本文', items: [{ num: '1', text: '号' }, { num: '12_2', text: '号' }] }]
		});
	});
});

describe('基準4：変更点の確かめ', () => {
	const p = (text: string) => [{ num: '1', text, items: [] }];
	const base: (Article & { id: number })[] = [
		{ id: 10, num: '1', label: '第1条', caption: '（目的）', paragraphs: p('目的') },
		{ id: 11, num: '2', label: '第2条', caption: '（定義）', paragraphs: p('定義') },
		{ id: 12, num: '3', label: '第3条', caption: '', paragraphs: p('削除') }
	];
	const amend = (over: Partial<BillChange> = {}): BillChange => ({ op: 'amend', num: '1', provisionId: 10, caption: '（目的）', paragraphs: p('新しい目的'), ...over });
	const add = (num: string): BillChange => ({ op: 'add', num, provisionId: null, caption: null, paragraphs: p('足す条') });
	const del = (id: number, num: string): BillChange => ({ op: 'delete', num, provisionId: id, caption: null, paragraphs: null });
	const errors = (action: 'amend' | 'repeal' | 'enact', changes: BillChange[], b: typeof base | null = base) => {
		const r = checkChanges(action, b, changes);
		return r.ok ? [] : r.errors;
	};

	test('書きかえ・追加（枝番）・削除・制定の新法', () => {
		// 通るもの
		expect(errors('amend', [amend(), add('2_2'), add('2_2_2'), del(11, '2'), amend({ num: '3', provisionId: 12, caption: '（復活）', paragraphs: p('中身') })])).toEqual([]);
		expect(errors('repeal', [])).toEqual([]);
		expect(errors('enact', [{ ...add('1'), caption: '（目的）', paragraphs: p('この法律は') }, add('2')], null)).toEqual([]);

		// 書きかえ
		expect(errors('amend', [amend({ provisionId: 99 })])).toEqual([{ index: 0, error: 'unknownProvision' }]);
		expect(errors('amend', [amend({ num: '2' })])).toEqual([{ index: 0, error: 'numMismatch' }]);
		expect(errors('amend', [amend({ paragraphs: p('目的') })])).toEqual([{ index: 0, error: 'unchanged' }]);
		expect(errors('amend', [amend({ paragraphs: null })])).toEqual([{ index: 0, error: 'bodyMissing' }]);
		expect(errors('amend', [amend({ caption: 'あ'.repeat(101) })])).toEqual([{ index: 0, error: 'captionTooLong' }]);
		expect(errors('amend', [amend({ caption: '（目\n的）' })])).toEqual([{ index: 0, error: 'captionInvalid' }]);
		// 削除
		expect(errors('amend', [del(12, '3')])).toEqual([{ index: 0, error: 'deleteDeleted' }]);
		expect(errors('amend', [{ ...del(11, '2'), paragraphs: p('x') }])).toEqual([{ index: 0, error: 'deleteHasBody' }]);
		// 追加
		expect(errors('amend', [add('4')])).toEqual([{ index: 0, error: 'addNotBranch' }]);
		expect(errors('amend', [add('5_2')])).toEqual([{ index: 0, error: 'addNoParent' }]);
		expect(errors('amend', [add('2_2'), add('2_2')])).toEqual([{ index: 1, error: 'duplicate' }]);
		// 同じ条に2つ
		expect(errors('amend', [amend(), del(10, '1')])).toEqual([{ index: 1, error: 'duplicate' }]);
		// 法令ごとの決まり
		expect(errors('amend', [])).toEqual([{ index: -1, error: 'amendEmpty' }]);
		expect(errors('repeal', [amend()])).toEqual([{ index: -1, error: 'repealHasChanges' }]);
		expect(errors('enact', [add('2')], null)).toEqual([{ index: 0, error: 'enactNumOrder' }]);
		expect(errors('enact', [amend()], null)).toEqual([{ index: 0, error: 'enactNotAdd' }]);
		expect(errors('enact', [{ ...add('1'), caption: '（定義）' }], null)).toEqual([{ index: -1, error: 'enactPurpose' }]);
		expect(errors('enact', [], null)).toEqual([{ index: -1, error: 'enactPurpose' }]);
	});
});

describe('基準5：法案の確かめ', () => {
	const ctx = { committeeLawIds: TARGET, visibleSolutionIds: new Set([1, 2, 3, 4, 5, 6]) };
	const ok = {
		kind: 'amend',
		title: '解約をいつでもできるようにする',
		affected: '定期購入の解約に困っている人',
		sideEffects: '事業者の負担が増える',
		summary: '',
		supplementary: '',
		laws: [{ action: 'amend', lawId: '412AC0000000061', newTitle: null }],
		changeCount: 1,
		solutionIds: ['1']
	};
	const errorsOf = (over: Partial<typeof ok> & Record<string, unknown>) => {
		const r = validateBill({ ...ok, ...over } as Parameters<typeof validateBill>[0], ctx);
		return r.ok ? {} : r.errors;
	};

	test('字数・必須・対象の法令の数と形・変更点と解決策の数', () => {
		const r = validateBill({ ...ok, summary: '1行目\n\n2行目\n3行目' }, ctx);
		expect(r).toMatchObject({ ok: true, value: { summary: '1行目\n2行目\n3行目', supplementary: null, solutionIds: [1] } });
		expect(errorsOf({ title: 'あ'.repeat(61), affected: '', sideEffects: 'あ'.repeat(401) })).toEqual({
			title: 'tooLong',
			affected: 'required',
			sideEffects: 'tooLong'
		});
		expect(errorsOf({ summary: '1\n2\n3\n4' })).toEqual({ summary: 'summaryLines' });
		expect(errorsOf({ summary: 'あ'.repeat(61) })).toEqual({ summary: 'tooLong' });
		expect(errorsOf({ supplementary: 'あ'.repeat(1001) })).toEqual({ supplementary: 'tooLong' });
		expect(errorsOf({ kind: 'bogus' })).toEqual({ kind: 'invalid' });
		// 対象の法令
		expect(errorsOf({ laws: [] })).toEqual({ laws: 'lawCount' });
		const six = ['a', 'b', 'c', 'd', 'e', 'f'].map(() => ({ action: 'amend', lawId: '412AC0000000061', newTitle: null }));
		expect(errorsOf({ laws: six })).toEqual({ laws: 'lawCount' });
		expect(errorsOf({ laws: [{ action: 'amend', lawId: '129AC0000000089', newTitle: null }] })).toEqual({ laws: 'lawNotInCommittee' });
		expect(errorsOf({ laws: [ok.laws[0], ok.laws[0]] })).toEqual({ laws: 'duplicateLaw' });
		expect(errorsOf({ laws: [ok.laws[0], { action: 'repeal', lawId: TARGET[0], newTitle: null }] })).toEqual({ laws: 'lawShape' });
		expect(errorsOf({ kind: 'repeal', laws: [{ action: 'repeal', lawId: TARGET[2], newTitle: null }, { action: 'amend', lawId: TARGET[0], newTitle: null }] })).toEqual({});
		expect(errorsOf({ kind: 'repeal', laws: [{ action: 'amend', lawId: TARGET[2], newTitle: null }] })).toEqual({ laws: 'lawShape' });
		const enact = (newTitle: string) => ({ kind: 'enact', laws: [{ action: 'enact', lawId: null, newTitle }, { action: 'amend', lawId: TARGET[0], newTitle: null }] });
		expect(errorsOf(enact('自転車の通行場所の表示に関する法律'))).toEqual({});
		expect(errorsOf(enact('サブスク解約法'))).toEqual({});
		expect(errorsOf(enact('サブスク解約のルール'))).toEqual({ newTitle: 'lawTitleSuffix' });
		expect(errorsOf(enact(''))).toEqual({ newTitle: 'required' });
		expect(errorsOf({ kind: 'enact', laws: [{ action: 'enact', lawId: TARGET[0], newTitle: '新法' }] })).toEqual({ laws: 'lawShape' });
		// 変更点と解決策の数
		expect(errorsOf({ changeCount: 51 })).toEqual({ changes: 'changeCount' });
		expect(errorsOf({ solutionIds: [] })).toEqual({ solutions: 'solutionCount' });
		expect(errorsOf({ solutionIds: ['1', '2', '3', '4', '5', '6'] })).toEqual({ solutions: 'solutionCount' });
		expect(errorsOf({ solutionIds: ['1', '1'] })).toEqual({ solutions: 'duplicateSolution' });
		expect(errorsOf({ solutionIds: ['7'] })).toEqual({ solutions: 'solutionHidden' });
	});
});

describe('信頼の境界：法案のフォームの値', () => {
	test('形の違う値と制御文字', () => {
		const ctx = { committeeLawIds: TARGET, visibleSolutionIds: new Set([1]) };
		const base = { kind: 'amend', title: 't', affected: 'a', sideEffects: 's', summary: null, supplementary: null, laws: [{ action: 'amend', lawId: TARGET[0], newTitle: null }], changeCount: 1, solutionIds: ['1'] };
		const errs = (over: Record<string, unknown>) => {
			const r = validateBill({ ...base, ...over } as Parameters<typeof validateBill>[0], ctx);
			return r.ok ? {} : r.errors;
		};
		expect(errs({ title: 'a\u202eb', affected: 'a\u0000b' })).toEqual({ title: 'control', affected: 'control' });
		expect(errs({ title: '1行目\n2行目' })).toEqual({ title: 'newline' });
		expect(errs({ title: undefined })).toEqual({ title: 'required' });
		for (const id of ['0', '-1', '1.5', 'abc', '01', '']) expect(errs({ solutionIds: [id] }), id).toEqual({ solutions: 'solutionHidden' });
		expect(errs({ laws: [{ action: 'bogus', lawId: TARGET[0], newTitle: null }] })).toEqual({ laws: 'lawShape' });
		expect(errs({ changeCount: -1 })).toEqual({ changes: 'changeCount' });
	});
});

describe('基準6：正式名', () => {
	test('改正・廃止・制定と、1本か2本以上か', () => {
		const t = (action: 'amend' | 'repeal' | 'enact', title: string) => ({ action, title });
		expect(formalName('amend', [t('amend', '消費者契約法')])).toBe('消費者契約法の一部を改正する法律案');
		expect(formalName('amend', [t('amend', '消費者契約法'), t('amend', '特定商取引に関する法律')])).toBe('消費者契約法等の一部を改正する法律案');
		expect(formalName('repeal', [t('repeal', '消費者契約法')])).toBe('消費者契約法を廃止する法律案');
		expect(formalName('repeal', [t('repeal', '消費者契約法'), t('amend', '特定商取引に関する法律')])).toBe('消費者契約法を廃止する法律案');
		expect(formalName('repeal', [t('repeal', '消費者契約法'), t('repeal', '特定商取引に関する法律')])).toBe('消費者契約法等を廃止する法律案');
		expect(formalName('enact', [t('enact', 'サブスク解約法'), t('amend', '消費者契約法')])).toBe('サブスク解約法案');
	});
});
