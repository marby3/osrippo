<script lang="ts">
	import { enhance } from '$app/forms';
	import { ja } from '#lib/copy/ja.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const issue = $derived(data.issue);
</script>

<svelte:head>
	<title>{ja.issue.pageTitle(issue.title)}</title>
</svelte:head>

<main>
	<h1>{issue.title}</h1>
	{#if issue.topicName}<p class="topic">{ja.issue.topicMark(issue.topicName)}</p>{/if}

	<h2>{ja.issue.affected}</h2>
	<p>{issue.affected}</p>
	<h2>{ja.issue.example}</h2>
	<p class="example">{issue.example}</p>

	<form method="post" action="?/support" use:enhance>
		<input type="hidden" name="op" value={issue.supported ? 'remove' : 'add'} />
		<button class="support" aria-pressed={issue.supported}>
			<svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20">
				<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2" />
				<path d="m8 12 3 3 5-6" fill="none" stroke="currentColor" stroke-width="2" />
			</svg>
			{ja.issue.support}
			{issue.supports}
		</button>
		<p class="hint">{ja.issue.supportHint}</p>
		{#if form && 'message' in form}<p role="alert">{form.message}</p>{/if}
	</form>
</main>

<style>
	main {
		max-width: 40rem;
		margin: 0 auto;
		padding: 1rem;
	}

	h1 {
		font-size: var(--font-size-page-title);
	}

	h2 {
		margin: 1rem 0 0;
		color: var(--color-text-sub);
		font-size: var(--font-size-sub);
	}

	h2 + p {
		margin-top: 0.25rem;
	}

	.topic {
		color: var(--color-text-sub);
		font-size: var(--font-size-sub);
	}

	.example {
		white-space: pre-wrap;
	}

	form {
		margin-top: 1.5rem;
		text-align: center;
	}

	.support {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		width: 100%;
		min-height: var(--tap-primary);
		border: 2px solid var(--color-base);
		border-radius: var(--radius-pill);
		background: var(--color-bg);
		color: var(--color-base);
		font: inherit;
		font-weight: bold;
	}

	.support[aria-pressed='true'] {
		background: var(--color-base);
		color: var(--color-bg);
	}

	.hint {
		color: var(--color-text-sub);
		font-size: var(--font-size-sub);
	}

	[role='alert'] {
		color: var(--color-caution);
	}
</style>
