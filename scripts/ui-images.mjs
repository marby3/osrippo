// UI案キャンバスのアートボード（*.dc.html）をPNGにして docs/ui/ に置く。
// 使い方：node scripts/ui-images.mjs <キャンバスの project/ を落としたフォルダ>
// キャンバスは Artifact の read でファイルごとに取得する（canvas.json と *.dc.html）。
import { chromium } from '@playwright/test';
import { readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const src = process.argv[2];
if (!src) throw new Error('キャンバスのフォルダを指定してください');
const out = 'docs/ui';
mkdirSync(out, { recursive: true });

const canvas = JSON.parse(readFileSync(join(src, 'canvas.json'), 'utf8'));
const files = Object.fromEntries(
	readdirSync(src)
		.filter((f) => f.endsWith('.dc.html'))
		.map((f) => [f.replace('.dc.html', ''), readFileSync(join(src, f), 'utf8')])
);

const browser = await chromium.launch();
for (const board of canvas.order) {
	const name = board.replace('.dc.html', '');
	const { w, h } = canvas.boards[board];
	const page = await browser.newPage({ viewport: { width: w, height: h } });
	await page.setContent('<!doctype html><html lang="ja"><head><meta charset="utf-8"></head><body></body></html>');
	// ブラウザの中で、テンプレート（sc-for / sc-if / dc-import / {{ }}）を展開する
	await page.evaluate(
		({ files, name }) => {
			class DCLogic {
				constructor(props) {
					this.props = props;
				}
			}
			const seenHead = new Set();
			const evalIn = (expr, scope) => {
				// 属性名（data-x など）のように、変数名にできない鍵は渡さない
				const keys = Object.keys(scope).filter((k) => /^[A-Za-z_$][\w$]*$/.test(k));
				return new Function(...keys, `return (${expr});`)(...keys.map((k) => scope[k]));
			};
			const fill = (s, scope) => s.replace(/\{\{\s*(.+?)\s*\}\}/g, (_, e) => String(evalIn(e, scope) ?? ''));
			const whole = (s, scope) => {
				const m = s.match(/^\{\{\s*(.+?)\s*\}\}$/);
				return m ? evalIn(m[1], scope) : s;
			};

			function component(n, props) {
				const doc = new DOMParser().parseFromString(files[n], 'text/html');
				for (const el of doc.querySelectorAll('helmet > *')) {
					const key = el.outerHTML;
					if (!seenHead.has(key)) seenHead.add(key), document.head.append(el.cloneNode(true));
				}
				const script = doc.querySelector('script[type="text/x-dc"]');
				const Component = new Function('DCLogic', `${script.textContent}; return Component;`)(DCLogic);
				const scope = { ...props, ...new Component(props).renderVals() };
				const root = [...doc.querySelector('x-dc').children].find((c) => c.tagName !== 'HELMET');
				return walk(root, scope);
			}

			function walk(node, scope) {
				if (node.nodeType === Node.TEXT_NODE) return [document.createTextNode(fill(node.textContent, scope))];
				if (node.nodeType !== Node.ELEMENT_NODE) return [];
				const tag = node.localName;
				const kids = (s) => [...node.childNodes].flatMap((c) => walk(c, s));
				if (tag === 'sc-for') {
					const as = node.getAttribute('as');
					return whole(node.getAttribute('list'), scope).flatMap((item) => kids({ ...scope, [as]: item }));
				}
				if (tag === 'sc-if') return whole(node.getAttribute('value'), scope) ? kids(scope) : [];
				if (tag === 'dc-import') {
					const props = {};
					for (const a of node.attributes) if (a.name !== 'name' && !a.name.startsWith('hint-')) props[a.name] = a.value;
					return component(node.getAttribute('name'), props);
				}
				// SVGのアイコンも描けるよう、名前空間を引き継ぐ
				const el = document.createElementNS(node.namespaceURI, tag);
				for (const a of node.attributes) el.setAttribute(a.name, fill(a.value, scope));
				el.append(...kids(scope));
				return [el];
			}

			document.body.append(...component(name, {}));
		},
		{ files, name }
	);
	await page.evaluate(() => document.fonts.ready);
	await page.screenshot({ path: join(out, `${name}.png`), fullPage: true });
	await page.close();
	console.log(name);
}
await browser.close();
