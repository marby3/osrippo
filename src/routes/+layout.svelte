<script lang="ts">
	import '#lib/styles/tokens.css';
	import '#lib/styles/base.css';
	import favicon from '#lib/assets/favicon.svg';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import IfBand from '#lib/components/IfBand.svelte';
	import LawCard from '#lib/components/LawCard.svelte';
	import SiteHeader from '#lib/components/SiteHeader.svelte';
	import { ja } from '#lib/copy/ja.ts';
	import { hidesTabsOnSp } from '#lib/menu.ts';
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

<!-- IF世界の帯はメニューより上（案 SpResult）。出すかはページの load が ifBand で決める -->
{#if page.data.ifBand}<IfBand />{/if}
<SiteHeader unread={data.menu.unread} hideTabsOnSp={hidesTabsOnSp(page.route.id)} legislatorName={data.legislatorName} />

{@render children()}

<footer>{ja.unofficial}</footer>
<!-- 本文の「特商法9条」のリンクを押すと出る条のカード（Issue #165）。本文を出すページだけで使う -->
{#if page.data.lawRefs}<LawCard />{/if}
<!-- スマホ：下に固定したタブ（タブを隠す画面では、下に留めたボタンの帯）の高さの分を空け、最後の行が隠れないようにする -->
{#if !hidesTabsOnSp(page.route.id)}
	<div class="tab-space" class:bar={page.data.spBottomBar} aria-hidden="true"></div>
{:else if page.data.spBottomBar}
	<div class="tab-space input-bar" aria-hidden="true"></div>
{/if}

<style>
	footer {
		padding: 1.5rem 1rem;
		color: var(--color-text-sub);
		font-size: var(--font-size-sub);
		text-align: center;
	}

	/* 下のタブの高さ（SiteHeader.svelte の nav a の 3.5rem と上の線 3px・区切り 1px）。片方を変えたらもう片方も */
	.tab-space {
		height: 3.75rem;
	}

	/* タブの上に留める帯（主ボタンと上下 0.5rem、区切り 1px。課題の一覧の .write-bar）の分も空ける */
	.tab-space.bar {
		height: calc(3.75rem + var(--tap-primary) + 1rem + 1px);
	}

	/* タブを隠す画面で、画面の下に留めるボタンの帯（ボタンと上下 0.5rem、区切り 1px。課題を書く画面の .buttons） */
	.tab-space.input-bar {
		height: calc(var(--tap-secondary) + 1rem + 1px);
	}

	@media (min-width: 64rem) {
		.tab-space {
			display: none;
		}
	}
</style>
