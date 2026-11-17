<script lang="ts">
	// 1か月の会期の帯（Issue #225）。区切りはホームの会期の帯と同じ 2:1:1。
	// current の区切りは、色のほかに太字・実線・「この段」で示す（ほかは点線）
	import { ja } from '#lib/copy/ja.ts';
	import FigureIcon from './FigureIcon.svelte';

	type Days = { proposeUntil: number; deliberation: number; discussUntil: number; vote: number };
	let { days, current = [], heading = true }: { days: Days; current?: number[]; heading?: boolean } = $props();
	const t = ja.figures.session;
	const segments = $derived(t.segments(days));
	/** 「この段」の括りが、どの列からどの列までか（current は続いた区切り）。全部が current なら括らない */
	const span = $derived(current.length && current.length < segments.length ? `${Math.min(...current) + 1} / ${Math.max(...current) + 2}` : null);
</script>

{#if heading}<p class="heading"><FigureIcon name="calendar" />{t.heading}</p>{/if}
<div class="band">
	{#if span}<span class="here" style:grid-column={span}>{t.here}</span>{/if}
	{#each segments as s, i (s.title)}
		<div class="segment" data-segment data-current={current.includes(i) ? '' : undefined} style:grid-column={i + 1}>
			<span class="title">{s.title}</span>
			<span class="days">{s.days}</span>
		</div>
	{/each}
</div>

<style>
	.heading {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		margin: 0 0 0.5rem;
		color: var(--color-text-sub);
		font-weight: bold;
	}

	.band {
		display: grid;
		grid-template-columns: 2fr 1fr 1fr;
		gap: 0.25rem;
	}

	/* 「この段」の括り：帯の上に、括る区切りの幅で線と文字 */
	.here {
		grid-row: 1;
		padding-bottom: 0.125rem;
		border-bottom: 3px solid var(--color-base);
		color: var(--color-base);
		font-weight: bold;
		text-align: center;
	}

	.segment {
		display: flex;
		grid-row: 2;
		flex-direction: column;
		align-items: center;
		min-width: 0;
		padding: 0.5rem 0.125rem;
		border: 2px dashed var(--color-input-border);
		border-radius: var(--radius-m);
		background: var(--color-bg);
		color: var(--color-text);
		font-weight: normal;
		text-align: center;
		overflow-wrap: anywhere;
	}

	.segment[data-current] {
		border-style: solid;
		border-color: var(--color-base);
		background: var(--color-base);
		color: var(--color-bg);
		font-weight: bold;
	}

	.title {
		font-size: var(--font-size-body);
	}
</style>
