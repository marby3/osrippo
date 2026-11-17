<script lang="ts">
	// 法案の書き方「変える条の書き方」の例に、各行が何にあたるかを書き込む（Issue #225）。
	// 例の文そのものが中身なので、ほかの図と違い読み上げる（figure と figcaption）。行の文字は元の例のまま。札と行頭の説明は選べないようにして、例の行だけを写せるようにする
	import { ja } from '#lib/copy/ja.ts';
	import { ITEM_LINE, PARAGRAPH_LINE } from '#lib/domain/bills.ts';
	import Arrow from './Arrow.svelte';
	import FigureIcon from './FigureIcon.svelte';

	let { example }: { example: string } = $props();
	const t = ja.figures.article;

	/** 行頭が号か、2項目からの項か（書く画面と同じ読み方）。mark は行頭の番号と全角の空白 */
	const head = (line: string, re: RegExp) => {
		const m = re.exec(line);
		return m ? { mark: line.slice(0, line.length - m[2].length), rest: m[2] } : null;
	};
	type Row = { tag: string; mark: string | null; rest: string; note: string | null };
	const rows = $derived.by(() => {
		let paragraph = 1;
		let item = 0;
		let itemNoted = false;
		let paragraphNoted = false;
		return example.split('\n').map((line, i): Row => {
			const asItem = head(line, ITEM_LINE);
			const asParagraph = head(line, PARAGRAPH_LINE);
			if (asItem) {
				item += 1;
				const note = itemNoted ? null : t.itemNote;
				itemNoted = true;
				return { tag: t.item(item), ...asItem, note };
			}
			if (asParagraph && i > 0) {
				paragraph += 1;
				item = 0;
				const note = paragraphNoted ? null : t.paragraphNote;
				paragraphNoted = true;
				return { tag: t.paragraph(paragraph), ...asParagraph, note };
			}
			return { tag: t.paragraph(paragraph), mark: null, rest: line, note: null };
		});
	});
</script>

<figure class="figure" data-figure>
	<figcaption><FigureIcon name="draft" /><span>{t.caption}</span></figcaption>
	<div class="rows">
		{#each rows as row, i (i)}
			<div class="row" data-row>
				<span class="tag" data-tag>{row.tag}</span>
				<span class="line" data-line>{#if row.mark}<span class="mark" data-mark>{row.mark}</span>{/if}{row.rest}</span>
				{#if row.note}<span class="note"><Arrow up />{row.note}</span>{/if}
			</div>
		{/each}
	</div>
</figure>

<style>
	.figure {
		margin: 0.75rem 0;
		padding: 0.75rem;
		border: 1px solid var(--color-input-border);
		border-radius: var(--radius-m);
		background: var(--color-surface);
		color: var(--color-text);
	}

	figcaption {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		margin-bottom: 0.5rem;
		color: var(--color-text-sub);
		font-size: var(--font-size-sub);
	}

	.rows {
		display: grid;
		grid-template-columns: max-content minmax(0, 1fr);
		gap: 0.5rem 0.75rem;
	}

	.row {
		display: grid;
		grid-column: 1 / -1;
		grid-template-columns: subgrid;
		align-items: baseline;
	}

	/* 札：左の列。線でつないだ見出し */
	.tag {
		padding: 0 0.5rem;
		border: 1px solid var(--color-base);
		border-radius: var(--radius-pill);
		background: var(--color-bg);
		color: var(--color-base);
		font-size: var(--font-size-sub);
		font-weight: bold;
		white-space: nowrap;
		user-select: none;
	}

	.line {
		line-height: var(--line-height-law);
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}

	/* 行頭の「一」「2」と全角の空白：点線の枠で囲み、空白も見えるようにする（色だけで示さない） */
	.mark {
		padding: 0 0.125rem;
		border: 2px dashed var(--color-base);
		border-radius: var(--radius-s);
		background: var(--color-bg);
		font-weight: bold;
	}

	.note {
		display: flex;
		gap: 0.25rem;
		align-items: center;
		grid-column: 2;
		margin-top: -0.25rem;
		color: var(--color-base);
		font-size: var(--font-size-sub);
		font-weight: bold;
		user-select: none;
	}

	figcaption :global(svg) {
		color: var(--color-base);
		fill: none;
		stroke: currentColor;
	}
</style>
