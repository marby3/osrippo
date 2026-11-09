<script lang="ts">
	import Crumbs from '#lib/components/Crumbs.svelte';
	import { afterNavigate } from '$app/navigation';
	import { ja } from '#lib/copy/ja.ts';
	import DiffText from '#lib/components/DiffText.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	// 選択欄は利用者が動かすので、比べて移動したあとに結果の版へ戻す。
	// 入れ替えで結果が前回と同じだと data は変わらないので、移動のたびに戻す。
	// ページを開いたとき（enter）は戻さない：スクリプトが動く前に選んだ版を消さないため（Issue #17）
	// bind:value にしないこと。ハイドレーションで利用者の選択を上書きしてしまう
	let maeSelect: HTMLSelectElement;
	let atoSelect: HTMLSelectElement;
	afterNavigate(({ type }) => {
		if (type === 'enter') return;
		maeSelect.value = data.mae;
		atoSelect.value = data.ato;
	});
</script>

<svelte:head>
	<title>{ja.compare.pageTitle(data.law.title)}</title>
</svelte:head>

<main class="frame">
	<Crumbs current={ja.compare.heading} />
	<p class="sub"><a href="/hourei/{data.law.id}">{data.law.title}</a></p>
	<h1>{ja.compare.heading}</h1>

	<form method="get">
		<label>
			<span>{ja.compare.before}</span>
			<select name="mae" bind:this={maeSelect}>
				{#each data.revisions as r (r.id)}
					<option value={r.id} selected={r.id === data.mae}>{ja.compare.option(r.date, r.title, r.scheduled)}</option>
				{/each}
			</select>
		</label>
		<label>
			<span>{ja.compare.after}</span>
			<select name="ato" bind:this={atoSelect}>
				{#each data.revisions as r (r.id)}
					<option value={r.id} selected={r.id === data.ato}>{ja.compare.option(r.date, r.title, r.scheduled)}</option>
				{/each}
			</select>
		</label>
		<button>{ja.compare.submit}</button>
	</form>

	{#each data.changes as change (change.num + change.kind)}
		<article aria-labelledby="article-{change.num}-{change.kind}">
			<h2>
				<span id="article-{change.num}-{change.kind}">{change.label}</span>
				{#if change.beforeLabel}<span class="note">{ja.compare.renumbered(change.beforeLabel)}</span>{/if}
				{#if change.kind === 'added'}<span class="note">{ja.compare.added}</span>{/if}
				{#if change.kind === 'removed'}<span class="note">{ja.compare.removed}</span>{/if}
			</h2>
			<!-- スマホは改正前が上の縦並び。PC は注記と見出しの行のある1つの新旧対照表（PcCompare、Issue #124） -->
			<div class="sides">
				<p class="legend">{ja.compare.legend}</p>
				{#if change.kind !== 'added'}
					<section class="before" aria-labelledby="before-{change.num}-{change.kind}">
						<h3 id="before-{change.num}-{change.kind}">{ja.compare.beforeSide}</h3>
						<DiffText parts={change.parts} show="removed" />
					</section>
				{/if}
				{#if change.kind !== 'removed'}
					<section class="after" aria-labelledby="after-{change.num}-{change.kind}">
						<h3 id="after-{change.num}-{change.kind}">{ja.compare.afterSide}</h3>
						<DiffText parts={change.parts} show="added" />
					</section>
				{/if}
			</div>
		</article>
	{:else}
		<p>{ja.compare.none}</p>
	{/each}
</main>

<style>
	main {
		padding: 1rem;
	}

	h1 {
		margin: 0 0 1rem;
		font-size: var(--font-size-page-title);
	}

	.sub,
	.note {
		color: var(--color-text-sub);
		font-size: var(--font-size-sub);
	}

	form {
		display: grid;
		gap: 0.75rem;
		margin-bottom: 1.5rem;
	}

	label span {
		display: block;
		font-weight: bold;
	}

	select {
		width: 100%;
		min-height: var(--tap-min);
		border: 1px solid var(--color-input-border);
		border-radius: var(--radius-m);
		background: var(--color-bg);
		color: var(--color-text);
		font: inherit;
	}

	button {
		min-height: var(--tap-primary);
		border: 0;
		border-radius: var(--radius-l);
		background: var(--color-base);
		color: var(--color-bg);
		font: inherit;
		font-weight: bold;
	}

	article {
		margin-bottom: 1.5rem;
	}

	h2 {
		font-size: var(--font-size-body);
	}

	.note {
		margin-left: 0.5em;
		font-weight: normal;
	}

	/* スマホ：改正前→改正後の縦並び */
	.sides {
		display: grid;
		gap: 0.75rem;
	}

	section {
		border: 1px solid var(--color-divider);
		border-radius: var(--radius-l);
		padding: 0 1rem;
	}

	h3 {
		margin: 0.75rem 0 0;
		font-size: var(--font-size-sub);
	}

	.legend {
		display: none;
	}

	/* PC：改正後を左、改正前を右の新旧対照表。いちばん上の行に注記、次の行に見出し */
	@media (min-width: 48rem) {
		form {
			grid-template-columns: 1fr 1fr auto;
			align-items: end;
		}

		button {
			padding: 0 1.5rem;
		}

		.sides {
			grid-template-columns: 1fr 1fr;
			gap: 0;
			border: 1px solid var(--color-input-border);
			border-radius: var(--radius-l);
			overflow: hidden;
		}

		.legend {
			display: block;
			grid-area: 1 / 1 / 2 / 3;
			margin: 0;
			padding: 0.5rem 1rem;
			border-bottom: 1px solid var(--color-input-border);
			color: var(--color-text-sub);
			font-size: var(--font-size-sub);
		}

		section {
			border: 0;
			border-radius: 0;
			padding: 0;
		}

		.after {
			grid-area: 2 / 1;
		}

		.before {
			grid-area: 2 / 2;
			border-left: 1px solid var(--color-input-border);
		}

		h3 {
			margin: 0;
			padding: 0.75rem 1rem;
			border-bottom: 1px solid var(--color-input-border);
			background: var(--color-surface);
		}

		section > :global(p) {
			padding: 0 1rem;
		}
	}
</style>
