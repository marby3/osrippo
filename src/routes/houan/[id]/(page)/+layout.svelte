<script lang="ts">
	// 法案のページの上の部分とタブ（SpBillSummary・PcBillSummary）。質疑のタブは発議から出す（Issue #66）
	import { page } from '$app/state';
	import { ja } from '#lib/copy/ja.ts';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();
	const bill = $derived(data.bill);
	const base = $derived(`/houan/${bill.id}`);
	const tabs = $derived([
		{ href: base, label: ja.bill.page.summaryTab },
		{ href: `${base}/henkou`, label: ja.bill.page.changesTab(bill.changeCount) },
		...(data.questionCount === null ? [] : [{ href: `${base}/shitsugi`, label: ja.bill.page.questionsTab(data.questionCount) }]),
		...(data.amendmentTotal === null ? [] : [{ href: `${base}/shusei`, label: ja.bill.page.amendmentsTab(data.amendmentTotal) }])
	]);
</script>

<main>
	<nav class="crumbs pc" aria-label={ja.bill.page.crumbs}>
		<a href="/houan">{ja.bill.page.breadcrumb}</a> {ja.bill.page.crumbSeparator} <span>{bill.title}</span>
	</nav>
	<p class="badge">{ja.bill.kinds[bill.kind]}</p>
	<h1>{bill.title}</h1>
	<p class="formal">{bill.formalName}</p>
	{#if data.origin}<p class="formal">{ja.bill.resubmit.origin}<a href="/houan/{data.origin.id}">{data.origin.title}</a></p>{/if}
	{#if data.merge.origins.length}
		<p class="formal">
			{ja.bill.resubmit.origin}{#each data.merge.origins as origin, i (origin.id)}{#if i > 0}{ja.bill.merge.separator}{/if}<a href="/houan/{origin.id}">{origin.title}</a>{#if origin.waiting}{ja.bill.merge.waiting}{/if}{/each}
		</p>
	{/if}
	{#if data.stage === 'withdrawn'}
		<p class="withdrawn">
			{#if data.merge.mergedInto}{ja.bill.merge.mergedInto}<a href="/houan/{data.merge.mergedInto.id}">{data.merge.mergedInto.title}</a>{:else}{ja.bill.withdraw.done}{/if}
		</p>
	{:else if data.merge.merged.length}
		<p class="formal">{ja.bill.merge.link}{#each data.merge.merged as other, i (other.id)}{#if i > 0}{ja.bill.merge.separator}{/if}<a href="/houan/{other.id}">{other.title}</a>{/each}</p>
	{/if}
	<p class="now sp">
		{ja.bill.page.now}<strong>{ja.bill.progress[data.stage]}</strong>{#if data.progress === 'deliberation'}{ja.session.week(3)}{:else if data.progress === 'vote'}{ja.session.week(4)}{/if}
	</p>
	{#if data.next}<p class="next sp">{ja.bill.page.nextLine(ja.bill.progress[data.next.stage], data.next.session, data.next.at)}</p>{/if}
	{#if data.adjustment}<p class="adjusting">{ja.ifLaw.adjusting[data.adjustment.reason as 'article' | 'title']} {ja.ifLaw.due(data.adjustment.dueAt)}</p>{/if}
	{#if data.canEdit}<p class="edit"><a href="{base}/kaku">{data.adjustment ? ja.ifLaw.fix : ja.bill.page.edit}</a></p>{/if}

	<nav class="tabs" aria-label={ja.bill.page.tabs}>
		{#each tabs as tab (tab.href)}
			<!-- 質疑を書く画面でも質疑のタブを選んだ形にする -->
			<a href={tab.href} aria-current={page.url.pathname === tab.href || (tab.href !== base && page.url.pathname.startsWith(`${tab.href}/`)) ? 'page' : undefined}>{tab.label}</a>
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

	.withdrawn {
		margin: 0.5rem 0 0;
		padding: 0.75rem 1rem;
		border: 1px solid var(--color-divider);
		border-radius: var(--radius-m);
		overflow-wrap: anywhere;
	}

	.adjusting {
		margin: 0.5rem 0 0;
		padding: 0.75rem 1rem;
		border: 1px solid var(--color-caution);
		border-radius: var(--radius-m);
		background: var(--color-caution-bg);
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

	.next {
		margin: 0.25rem 0 0;
		color: var(--color-text-sub);
		font-size: var(--font-size-sub);
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
		grid-auto-flow: column;
		grid-auto-columns: 1fr;
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
