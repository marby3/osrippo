<script lang="ts">
	import { ja } from '#lib/copy/ja.ts';
	import type { DiffPart } from '#lib/server/law.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>{ja.compare.pageTitle(data.law.title)}</title>
</svelte:head>

{#snippet side(parts: DiffPart[], show: 'removed' | 'added')}
	<p class="text">
		{#each parts as part, i (i)}
			{#if part.removed}
				{#if show === 'removed'}<del>−{part.value}</del>{/if}
			{:else if part.added}
				{#if show === 'added'}<ins>＋{part.value}</ins>{/if}
			{:else}{part.value}{/if}
		{/each}
	</p>
{/snippet}

<main>
	<p class="sub"><a href="/hourei/{data.law.id}">{data.law.title}</a></p>
	<h1>{ja.compare.heading}</h1>

	<form method="get">
		<label>
			<span>{ja.compare.before}</span>
			<select name="mae" value={data.mae}>
				{#each data.revisions as r (r.id)}
					<option value={r.id}>{ja.compare.option(r.date, r.title, r.scheduled)}</option>
				{/each}
			</select>
		</label>
		<label>
			<span>{ja.compare.after}</span>
			<select name="ato" value={data.ato}>
				{#each data.revisions as r (r.id)}
					<option value={r.id}>{ja.compare.option(r.date, r.title, r.scheduled)}</option>
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
			<div class="sides">
				{#if change.kind !== 'added'}
					<section class="before" aria-label={ja.compare.beforeSide}>
						<h3>{ja.compare.beforeSide}</h3>
						{@render side(change.parts, 'removed')}
					</section>
				{/if}
				{#if change.kind !== 'removed'}
					<section class="after" aria-label={ja.compare.afterSide}>
						<h3>{ja.compare.afterSide}</h3>
						{@render side(change.parts, 'added')}
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
		max-width: 64rem;
		margin: 0 auto;
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

	.text {
		line-height: var(--line-height-law);
		white-space: pre-line;
	}

	del {
		background: var(--color-del-bg);
		color: var(--color-del-text);
		text-decoration: line-through;
	}

	ins {
		background: var(--color-ins-bg);
		color: var(--color-ins-text);
		text-decoration: underline;
	}

	/* PC：改正後を左、改正前を右の新旧対照表 */
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
			align-items: start;
		}

		.after {
			order: -1;
		}

		.before:only-child {
			grid-column: 2;
		}
	}
</style>
