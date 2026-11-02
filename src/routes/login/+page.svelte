<script lang="ts">
	import { ja } from '#lib/copy/ja.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>{ja.login.pageTitle}</title>
</svelte:head>

<main>
	<h1>{ja.login.heading}</h1>
	<p>{ja.login.lead}</p>
	{#if data.failed}<p role="alert">{ja.login.failed}</p>{/if}
	<form method="post">
		<input type="hidden" name="next" value={data.next} />
		<button formaction="?/google">{ja.login.google}</button>
		<button formaction="?/line">{ja.login.line}</button>
	</form>
</main>

<style>
	main {
		max-width: 28rem;
		margin: 0 auto;
		padding: 1rem;
	}

	h1 {
		font-size: var(--font-size-page-title);
	}

	form {
		display: grid;
		gap: 0.75rem;
	}

	button {
		min-height: var(--tap-primary);
		border: 1px solid var(--color-input-border);
		border-radius: var(--radius-l);
		background: var(--color-bg);
		color: var(--color-text);
		font: inherit;
		font-weight: bold;
	}
</style>
