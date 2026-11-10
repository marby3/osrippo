<script lang="ts">
	import LegislatorNote from '#lib/components/LegislatorNote.svelte';
	import Crumbs from '#lib/components/Crumbs.svelte';
	import BillForm from '#lib/components/BillForm.svelte';
	import { ja } from '#lib/copy/ja.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<svelte:head>
	<title>{ja.bill.write.editPageTitle(data.edit.title)}</title>
</svelte:head>

<main>
	<Crumbs current={data.adjusting ? ja.ifLaw.fixHeading : ja.bill.write.editHeading} />
	<p class="sub"><a href="/houan/{data.edit.id}">{data.edit.title}</a></p>
	<h1>{data.adjusting ? ja.ifLaw.fixHeading : ja.bill.write.editHeading}</h1>
	{#each data.repealed as law (law.id)}<p class="notice">{law.named ? ja.ifLaw.lawRepealedNamed(law.title) : ja.ifLaw.lawRepealed}</p>{/each}
	<!-- 要調整を直しても賛同は保つ（docs/spec/72.md の B） -->
	{#if data.supports > 0 && !data.adjusting}<p class="notice">{ja.bill.support.resetNotice(data.supports)}</p>{/if}
	{#if data.legislator}
		<!-- 議員は法案を直せない（docs/spec/158.md の 3） -->
		<LegislatorNote />
	{:else}
		<BillForm
			laws={data.laws}
			candidates={data.candidates}
			initial={data.initial}
			articles={data.articles}
			siteKey={data.siteKey}
			edit={{ id: data.edit.id, rev: data.edit.rev }}
			dropped={data.dropped}
			conflicts={data.conflicts}
			goneRows={data.goneRows}
			goneLaws={data.repealed}
			adjusting={data.adjusting}
			titleFree={data.adjustmentReason === 'title'}
			back="/houan/{data.edit.id}"
			{form}
		/>
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

	.sub {
		font-size: var(--font-size-sub);
	}

	.notice {
		padding: 0.75rem 1rem;
		border-radius: var(--radius-m);
		background: var(--color-caution-bg);
	}
</style>
