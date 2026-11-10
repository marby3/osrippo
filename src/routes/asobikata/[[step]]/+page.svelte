<script lang="ts">
	// はじめての方へ：遊び方（Issue #131）。案がないので、課題を書く画面（#121）の「ステップ n / 3」と段の棒の形にそろえる。
	// 「前へ」「次へ」はふつうのリンク（スクリプトなしでも動く）
	import { ja } from '#lib/copy/ja.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const t = ja.asobikata;
	const steps = $derived(t.steps(data));
	const step = $derived(steps[data.step - 1]);
	const href = (n: number) => (n === 1 ? '/asobikata' : `/asobikata/${n}`);
</script>

<svelte:head>
	<title>{t.pageTitle(data.step)}</title>
</svelte:head>

<main class="frame">
	<p class="step-count">{t.stepCount(data.step)}</p>
	<ol class="steps" aria-label={t.stepsLabel}>
		{#each steps as s, i (s.title)}
			<li class:done={i + 1 < data.step} aria-current={i + 1 === data.step ? 'step' : undefined}><span class="label">{s.title}</span></li>
		{/each}
	</ol>

	<h1>{step.title}</h1>
	<p class="when">{step.when}</p>
	{#each step.body as line}<p>{line}</p>{/each}

	<ul class="links">
		{#each step.links as l (l.href)}<li><a href={l.href}>{l.label}</a></li>{/each}
	</ul>

	<nav class="pager" aria-label={t.pager}>
		{#if data.step > 1}<a class="prev" href={href(data.step - 1)}>{t.prev}</a>{/if}
		{#if data.step < 3}<a class="next" href={href(data.step + 1)}>{t.next}</a>{:else}<a class="next" href="/">{t.home}</a>{/if}
	</nav>
</main>

<style>
	main {
		max-width: 40rem;
		padding-top: 1.5rem;
		padding-bottom: 2rem;
	}
	.step-count {
		margin: 0 0 0.5rem;
		color: var(--color-text-sub);
		font-size: var(--font-size-sub);
		font-weight: bold;
	}
	.steps {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 0.375rem;
		margin: 0 0 1.5rem;
		padding: 0;
		list-style: none;
		color: var(--color-text-sub);
		font-size: var(--font-size-sub);
	}
	/* 段の棒：済んだ段といまの段は塗り、まだの段は白抜き（課題を書く画面と同じ） */
	.steps li::before {
		content: '';
		display: block;
		height: 0.375rem;
		border: 1px solid var(--color-input-border);
		border-radius: var(--radius-pill);
		background: var(--color-bg);
	}
	.steps li.done::before,
	.steps li[aria-current='step']::before {
		border-color: var(--color-base);
		background: var(--color-base);
	}
	.steps .label {
		display: block;
		padding-top: 0.25rem;
	}
	.steps li[aria-current='step'] .label {
		color: var(--color-text);
		font-weight: bold;
	}
	h1 {
		margin: 0;
		font-size: var(--font-size-page-title);
	}
	.when {
		margin: 0.25rem 0 1rem;
		color: var(--color-text-sub);
		font-size: var(--font-size-sub);
	}
	p {
		margin: 0 0 0.75rem;
	}
	.links {
		margin: 1.25rem 0 0;
		padding: 0;
		list-style: none;
	}
	.links li + li {
		margin-top: 0.5rem;
	}
	.links a {
		display: inline-flex;
		align-items: center;
		min-height: var(--tap-min);
	}
	.pager {
		display: flex;
		gap: 0.75rem;
		margin-top: 2rem;
	}
	.pager a {
		display: flex;
		flex: 1;
		align-items: center;
		justify-content: center;
		min-height: var(--tap-primary);
		border: 2px solid var(--color-base);
		border-radius: var(--radius-m);
		color: var(--color-base);
		font-weight: bold;
		text-decoration: none;
	}
	.pager .next {
		background: var(--color-base);
		color: var(--color-bg);
	}
</style>
