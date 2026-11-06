<script lang="ts">
	// 法案の修正案のタブ。古い順（先に出したものが先に採られる）
	import { page } from '$app/state';
	import AmendmentCard from '#lib/components/AmendmentCard.svelte';
	import { ja } from '#lib/copy/ja.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const base = $derived(`/houan/${data.bill.id}/shusei`);
	const here = $derived(page.url.pathname + page.url.search);
	const failure = $derived(form && 'amendment' in form && form.amendment != null ? { amendment: form.amendment, message: form.message ?? '' } : null);
</script>

<svelte:head>
	<title>{ja.amendment.pageTitle(data.bill.title)}</title>
	<!-- 架空の条文を出すので検索に載せない（docs/spec/72.md の F） -->
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="list">
	{#if data.canPost}
		{#if data.waitUntil !== null}
			<p class="note">{ja.amendment.tooNew(data.waitUntil)}</p>
		{:else}
			<a class="write" href="{base}/kaku">{ja.amendment.write}</a>
		{/if}
	{/if}
	{#each data.amendments as amendment (amendment.id)}
		<AmendmentCard
			{amendment}
			progress={data.progress}
			required={data.required}
			isAuthor={data.isAuthor}
			isSide={data.isSide}
			canAccept={data.canAccept}
			loggedIn={data.loggedIn}
			waiting={data.waitUntil !== null}
			eligible={data.eligible}
			siteKey={data.siteKey}
			updateHref="{base}/kaku?koushin={amendment.id}"
			back={here}
			message={failure?.amendment === amendment.id ? failure.message : undefined}
		/>
	{:else}
		<p class="note">{ja.amendment.empty}</p>
	{/each}
	{#if data.hasNext}<p class="more"><a href="{base}?page={data.page + 1}">{ja.amendment.more(data.total)}</a></p>{/if}
</div>

<style>
	.list {
		display: grid;
		gap: 1rem;
		max-width: 48rem;
		margin-top: 1.5rem;
	}

	.note,
	.more {
		margin: 0;
	}

	.note {
		color: var(--color-text-sub);
		font-size: var(--font-size-sub);
	}

	.write {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: var(--tap-primary);
		border-radius: var(--radius-m);
		background: var(--color-base);
		color: var(--color-bg);
		font-weight: bold;
		text-decoration: none;
	}
</style>
