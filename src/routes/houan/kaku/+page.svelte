<script lang="ts">
	import BillForm from '#lib/components/BillForm.svelte';
	import { ja } from '#lib/copy/ja.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<svelte:head>
	<title>{ja.bill.write.pageTitle}</title>
</svelte:head>

<main>
	<h1>{ja.bill.write.heading}</h1>
	{#if data.view === 'wait'}
		<p>{ja.bill.tooNew(data.until)}</p>
	{:else if data.view === 'start'}
		<p>{ja.bill.write.start}</p>
		<p><a href="/kadai">{ja.bill.write.toIssues}</a></p>
	{:else}
		<BillForm laws={data.laws} candidates={data.candidates} initial={data.initial} articles={data.articles} siteKey={data.siteKey} back={data.back} {form} />
	{/if}
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
</style>
