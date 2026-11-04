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
	<BillForm
		laws={data.laws}
		candidates={data.candidates}
		initial={data.initial}
		articles={data.articles}
		siteKey={data.siteKey}
		edit={{ id: data.edit.id, rev: data.edit.rev }}
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
</style>
