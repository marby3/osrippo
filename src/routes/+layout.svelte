<script lang="ts">
	import '#lib/styles/tokens.css';
	import '#lib/styles/base.css';
	import favicon from '#lib/assets/favicon.svg';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import IfBand from '#lib/components/IfBand.svelte';
	import SiteHeader from '#lib/components/SiteHeader.svelte';
	import { ja } from '#lib/copy/ja.ts';
	import { hasIfBand } from '#lib/menu.ts';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();

	// ハイドレーションが済んだ印（画面のテストが待つ）
	onMount(() => {
		document.body.dataset.hydrated = '';
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<!-- IF世界の帯はメニューより上（案 SpResult）。誤りのページには出さない -->
{#if hasIfBand(page.route.id) && !page.error}<IfBand />{/if}
<SiteHeader unread={data.menu.unread} />

{@render children()}

<footer>{ja.unofficial}</footer>
<!-- スマホ：下に固定したタブの高さの分を空け、最後の行が隠れないようにする -->
<div class="tab-space" aria-hidden="true"></div>

<style>
	footer {
		padding: 1.5rem 1rem;
		color: var(--color-text-sub);
		font-size: var(--font-size-sub);
		text-align: center;
	}

	.tab-space {
		height: 3.75rem;
	}

	@media (min-width: 64rem) {
		.tab-space {
			display: none;
		}
	}
</style>
