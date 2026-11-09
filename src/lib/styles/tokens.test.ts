// Issue #4 デザインの決まり（Tokens）を CSS 変数に移す
import { expect, test } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const SRC = new URL('../../', import.meta.url).pathname;
const TOKENS = join(SRC, 'lib/styles/tokens.css');

function variables(css: string): Record<string, string> {
	const vars: Record<string, string> = {};
	for (const [, name, value] of css.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) vars[name] = value.trim().toLowerCase();
	return vars;
}

test('基準1：Tokens の値が CSS 変数になっている', () => {
	const expected: Record<string, string> = {
		// Tokens の色
		'--color-base': '#26324a',
		'--color-text': '#1a1a1c',
		'--color-text-sub': '#55555c',
		'--color-link': '#1a56c7',
		'--color-input-border': '#7a7a82',
		'--color-divider': '#949499',
		'--color-if': '#5a3c9e',
		'--color-if-dark': '#4b3087',
		'--color-caution': '#a15c00',
		'--color-caution-bg': '#fff4d6',
		'--color-support': '#1a56c7',
		'--color-oppose': '#b5480b',
		// 各画面で使われている補助の色
		'--color-surface': '#f5f5f7',
		'--color-del-bg': '#ffe7d6',
		'--color-del-text': '#8a3b00',
		'--color-ins-bg': '#dce9ff',
		'--color-ins-text': '#0b3e9c',
		'--color-if-bg': '#f2eefa',
		'--color-link-hover': '#123e91',
		'--color-focus': '#ffd43d',
		// 文字の大きさ（16px = 1rem）
		'--font-size-page-title': '1.375rem',
		'--font-size-heading': '1.125rem',
		'--font-size-body': '1rem',
		'--font-size-sub': '0.875rem',
		'--font-size-min': '0.8125rem',
		// 行の高さ
		'--line-height-body': '1.7',
		'--line-height-law': '2',
		// 押せる大きさ
		'--tap-primary': '3.25rem',
		'--tap-secondary': '3rem',
		'--tap-min': '2.75rem',
		// 角丸
		'--radius-s': '4px',
		'--radius-m': '8px',
		'--radius-l': '12px'
	};
	const vars = variables(existsSync(TOKENS) ? readFileSync(TOKENS, 'utf8') : '');
	expect(Object.fromEntries(Object.keys(expected).map((k) => [k, vars[k]]))).toEqual(expected);
});

function files(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
		const p = join(dir, e.name);
		return e.isDirectory() ? files(p) : [p];
	});
}

/**
 * 色の直書きを探す。コメント（/* *\/・<!-- -->・行の頭の //）は色を付けないので外す。
 * コメントに書く「Issue #120」が3桁の色に見えるため。行の途中の // は URL と見分けにくいので外さない
 */
function colorLiterals(source: string): string[] {
	const code = source
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.replace(/<!--[\s\S]*?-->/g, '')
		.replace(/^\s*\/\/.*$/gm, '');
	return [...code.matchAll(/#[0-9a-f]{3,8}\b|\b(rgb|hsl)a?\(/gi)].map((m) => m[0]);
}

test('色の直書きの探し方：コメントの中の「Issue #120」などは数えず、コードの色は数える', () => {
	const source = ['/* Issue #120 */', '<!-- Issue #118 -->', '\t// Issue #119', '\t/** Issue #122 */', 'a { color: #fff; }'].join('\n');
	expect(colorLiterals(source)).toEqual(['#fff']);
});

test('基準3：tokens.css 以外の .svelte と .css に色の直書きがない', () => {
	const found = files(SRC)
		.filter((p) => /\.(svelte|css)$/.test(p) && p !== TOKENS)
		.flatMap((p) => colorLiterals(readFileSync(p, 'utf8')).map((m) => `${p.slice(SRC.length)}: ${m}`));
	expect(found).toEqual([]);
});
