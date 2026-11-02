<script lang="ts">
	import '#lib/styles/tokens.css';
	import '#lib/styles/base.css';
	import favicon from '#lib/assets/favicon.svg';
	import { onMount } from 'svelte';
	import { ja } from '#lib/copy/ja.ts';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();

	// ハイドレーションが済んだ印（画面のテストが待つ）
	onMount(() => {
		document.body.dataset.hydrated = '';
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{@render children()}

<footer>{ja.unofficial}</footer>

<style>
	footer {
		padding: 1.5rem 1rem;
		color: var(--color-text-sub);
		font-size: var(--font-size-sub);
		text-align: center;
	}
</style>
