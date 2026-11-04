<script lang="ts">
	import BillForm from '#lib/components/BillForm.svelte';
	import { ja } from '#lib/copy/ja.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<svelte:head>
	<title>{ja.bill.write.editPageTitle(data.edit.title)}</title>
</svelte:head>

<main>
	<p class="sub"><a href="/houan/{data.edit.id}">{data.edit.title}</a></p>
	<h1>{ja.bill.write.editHeading}</h1>
	{#if data.supports > 0}<p class="notice">{ja.bill.support.resetNotice(data.supports)}</p>{/if}
	<BillForm
		laws={data.laws}
		candidates={data.candidates}
		initial={data.initial}
		articles={data.articles}
		siteKey={data.siteKey}
		edit={{ id: data.edit.id, rev: data.edit.rev }}
		dropped={data.dropped}
		back="/houan/{data.edit.id}"
		{form}
	/>
</main>

<style>
	main {
		max-width: 40rem;
		margin: 0 auto;
		padding: 1rem;
	}

	h1 {
		font-size: var(--font-size-page-title);
	}

	.sub {
		font-size: var(--font-size-sub);
	}

	.notice {
		padding: 0.75rem 1rem;
		border-radius: var(--radius-m);
		background: var(--color-caution-bg);
	}
</style>
