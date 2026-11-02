<script lang="ts">
	import { ja } from '#lib/copy/ja.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>{ja.watashi.pageTitle}</title>
</svelte:head>

<main>
	<h1>{ja.watashi.heading}</h1>
	<p>{ja.watashi.name}</p>
	<p class="name">{data.name}</p>
	<form method="post" action="/logout">
		<button>{ja.watashi.logout}</button>
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

	.name {
		font-size: var(--font-size-heading);
		font-weight: bold;
	}

	button {
		min-height: var(--tap-min);
		border: 1px solid var(--color-input-border);
		border-radius: var(--radius-m);
		background: var(--color-bg);
		color: var(--color-text);
		font: inherit;
		padding: 0 1rem;
	}
</style>
