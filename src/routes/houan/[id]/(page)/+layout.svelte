<script lang="ts">
	// 法案のページの上の部分とタブ（SpBillSummary・PcBillSummary）。質疑のタブは作るときまで出さない（Issue #46 決めたこと4）
	import { page } from '$app/state';
	import { ja } from '#lib/copy/ja.ts';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();
	const bill = $derived(data.bill);
	const base = $derived(`/houan/${bill.id}`);
	const tabs = $derived([
		{ href: base, label: ja.bill.page.summaryTab },
		{ href: `${base}/henkou`, label: ja.bill.page.changesTab(bill.changeCount) }
	]);
</script>

<main>
	<nav class="crumbs pc" aria-label={ja.bill.page.crumbs}>
		<a href="/houan">{ja.bill.page.breadcrumb}</a> {ja.bill.page.crumbSeparator} <span>{bill.title}</span>
	</nav>
	<p class="badge">{ja.bill.kinds[bill.kind]}</p>
	<h1>{bill.title}</h1>
	<p class="formal">{bill.formalName}</p>
	<p class="now sp">{ja.bill.page.now}<strong>{ja.bill.statuses[bill.status]}</strong></p>
	{#if data.canEdit}<p class="edit"><a href="{base}/kaku">{ja.bill.page.edit}</a></p>{/if}

	<nav class="tabs" aria-label={ja.bill.page.tabs}>
		{#each tabs as tab (tab.href)}
			<a href={tab.href} aria-current={page.url.pathname === tab.href ? 'page' : undefined}>{tab.label}</a>
		{/each}
	</nav>

	{@render children()}
</main>

<style>
	main {
		max-width: 76rem;
		margin: 0 auto;
		padding: 1rem;
	}

	.badge {
		display: inline-block;
		margin: 0;
		padding: 0 0.5rem;
		border: 1px solid var(--color-text);
		border-radius: var(--radius-s);
		font-size: var(--font-size-min);
		font-weight: bold;
	}

	h1 {
		margin: 0.5rem 0 0;
		font-size: var(--font-size-page-title);
	}

	.formal,
	.crumbs {
		margin: 0.25rem 0 0;
		color: var(--color-text-sub);
		font-size: var(--font-size-sub);
	}

	.now {
		margin: 0.5rem 0 0;
	}

	.edit {
		margin: 0.5rem 0 0;
	}

	.edit a {
		display: inline-flex;
		align-items: center;
		min-height: var(--tap-min);
	}

	.tabs {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		margin: 1rem -1rem 0;
		border-bottom: 1px solid var(--color-divider);
	}

	.tabs a {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: var(--tap-min);
		color: var(--color-text-sub);
		text-decoration: none;
	}

	.tabs a[aria-current='page'] {
		border-bottom: 3px solid var(--color-base);
		color: var(--color-text);
		font-weight: bold;
	}

	.pc {
		display: none;
	}

	@media (min-width: 64rem) {
		main {
			padding: 1.5rem 4rem;
		}

		.pc {
			display: block;
		}

		.sp {
			display: none;
		}

		.crumbs {
			margin-bottom: 1rem;
		}

		.tabs {
			display: flex;
			margin: 1.5rem 0 0;
		}

		.tabs a {
			padding: 0 1.25rem;
		}
	}
</style>
