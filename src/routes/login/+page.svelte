<script lang="ts">
	import Turnstile from '#lib/components/Turnstile.svelte';
	import { ja } from '#lib/copy/ja.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	let token = $state('');
</script>

<svelte:head>
	<title>{ja.login.pageTitle}</title>
</svelte:head>

<main>
	<h1>{ja.login.heading}</h1>
	<p>{ja.login.lead}</p>
	{#if data.failed}<p role="alert">{ja.login.failed}</p>{/if}
	{#if form?.message}<p role="alert">{form.message}</p>{/if}
	<form method="post">
		<input type="hidden" name="next" value={data.next} />
		<Turnstile siteKey={data.siteKey} bind:token />
		<button formaction="?/google" disabled={!token}>{ja.login.google}</button>
		<button formaction="?/line" disabled={!token}>{ja.login.line}</button>
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

	button:disabled {
		opacity: 0.5;
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
