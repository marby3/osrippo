<script lang="ts">
	// この課題から生まれた法案の一覧（Issue #125）。種類の札・題名（法案のページへ）・いまの状態（法案の一覧のタブの名前）
	import Crumbs from '#lib/components/Crumbs.svelte';
	import { ja } from '#lib/copy/ja.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	{#if data.view === 'full'}
		<title>{ja.issue.billsPageTitle(data.issue.title)}</title>
	{:else}
		<title>{ja.hidden.pageTitle}</title>
	{/if}
	{#if data.view !== 'full' || data.hidden}
		<meta name="robots" content="noindex" />
	{/if}
</svelte:head>

<main class="frame">
	<Crumbs current={ja.issue.billsHeading} />
	{#if data.view === 'hidden'}
		<h1>{ja.hidden.heading}</h1>
		<p>{data.status === 'auto_hidden' ? ja.hidden.auto : ja.hidden.staff(ja.hideReasons[data.statusReason ?? 'other'])}</p>
		<p><a href="/unei">{ja.hidden.toLog}</a></p>
	{:else}
		<p class="issue"><a href="/kadai/{data.issue.id}">{data.issue.title}</a></p>
		<h1>{ja.issue.billsHeading}</h1>
		{#if data.bills.length}
			<ul>
				{#each data.bills as bill (bill.id)}
					<li>
						<span class="badge">{ja.bill.kinds[bill.kind]}</span>
						<a href="/houan/{bill.id}">{bill.title}</a>
						<span class="state">{ja.bill.list.tabNames[bill.tab]}</span>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="empty">{ja.issue.billsEmpty}</p>
		{/if}
	{/if}
</main>

<style>
	main {
		padding: 1rem;
	}

	h1 {
		font-size: var(--font-size-page-title);
	}

	.issue,
	.state,
	.empty {
		color: var(--color-text-sub);
		font-size: var(--font-size-sub);
	}

	ul {
		margin: 0;
		padding: 0;
		border-top: 1px solid var(--color-divider);
		list-style: none;
	}

	li {
		display: grid;
		gap: 0.25rem;
		justify-items: start;
		padding: 1rem 0;
		border-bottom: 1px solid var(--color-divider);
	}

	li a {
		color: var(--color-text);
		font-weight: bold;
	}

	.badge {
		display: inline-block;
		padding: 0 0.5rem;
		border: 1px solid var(--color-text);
		border-radius: var(--radius-s);
		font-size: var(--font-size-min);
		font-weight: bold;
	}
</style>
