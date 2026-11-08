<script lang="ts">
	// パンくず（案 PcIssue「課題 ／ 課題の詳細」、Issue #85）。PC だけに出す。前はタブの一覧へのリンク、後ろはそのページの名前
	import { page } from '$app/state';
	import { ja } from '../copy/ja';
	import { TABS, tabOf } from '../menu';

	let {
		current,
		keepOnSp = false
	}: {
		current: string;
		/** スマホでも後ろ（そのページの名前）だけを出す（案 SpVote の「割り当て 2 / 3」、SpResult の「10月会期」） */
		keepOnSp?: boolean;
	} = $props();

	const tab = $derived(TABS.find((t) => t.key === tabOf(page.url.pathname)));
</script>

{#if tab}
	<nav class:keep={keepOnSp} aria-label={ja.menu.crumbs}>
		<span class="trail"><a href={tab.href}>{ja.menu.tabs[tab.key]}</a> {ja.menu.crumbSeparator}{' '}</span><span>{current}</span>
	</nav>
{/if}

<style>
	nav {
		display: none;
		margin: 0 0 0.75rem;
		color: var(--color-text-sub);
		font-size: var(--font-size-sub);
	}

	nav.keep {
		display: block;
	}

	nav.keep .trail {
		display: none;
	}

	@media (min-width: 64rem) {
		nav {
			display: block;
		}

		nav.keep .trail {
			display: inline;
		}
	}
</style>
