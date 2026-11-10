<script lang="ts">
	import LegislatorNote from '#lib/components/LegislatorNote.svelte';
	// 法案の修正案のタブ。古い順（先に出したものが先に採られる）
	import { page } from '$app/state';
	import AmendmentCard from '#lib/components/AmendmentCard.svelte';
	import { ja } from '#lib/copy/ja.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const base = $derived(`/houan/${data.bill.id}/shusei`);
	const here = $derived(page.url.pathname + page.url.search);
	const failure = $derived(form && 'amendment' in form && form.amendment != null ? { amendment: form.amendment, message: form.message ?? '' } : null);
	/** 通報の結果（そのカードに出す） */
	const reportResult = $derived(form?.reportAmendment != null ? { amendment: form.reportAmendment, done: form.reportMessage, message: form.message } : null);
	/** カードが出ていなければ（開いたあとに非表示になった、など）、結果を一覧の上に出す */
	const goneNotice = $derived.by(() => {
		const shownHere = (id: number) => data.amendments.some((a) => a.id === id);
		if (reportResult && !shownHere(reportResult.amendment)) return reportResult.done ?? reportResult.message;
		if (failure && !shownHere(failure.amendment)) return failure.message;
		return undefined;
	});
</script>

<svelte:head>
	<title>{ja.amendment.pageTitle(data.bill.title)}</title>
	<!-- 架空の条文を出すので検索に載せない（docs/spec/72.md の F） -->
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="list">
	{#if goneNotice}<p role="status" class="gone">{goneNotice}</p>{/if}
	{#if data.canPost}
		{#if data.legislator}
			<LegislatorNote />
		{:else if data.waitUntil !== null}
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
			legislator={data.legislator}
			siteKey={data.siteKey}
			updateHref="{base}/kaku?koushin={amendment.id}"
			back={here}
			message={failure?.amendment === amendment.id ? failure.message : undefined}
			staffHere={data.staffHere}
			reported={data.reportedIds.includes(amendment.id)}
			reportDone={reportResult?.amendment === amendment.id ? reportResult.done : undefined}
			reportMessage={reportResult?.amendment === amendment.id ? reportResult.message : undefined}
		/>
	{:else}
		<p class="note">{ja.amendment.empty}</p>
	{/each}
	{#if data.hasNext}<p class="more"><a href="{base}?page={data.page + 1}">{ja.amendment.more(data.total)}</a></p>{/if}
	{#if data.hiddenAmendments.length}
		<section class="hidden-amendments" aria-labelledby="hidden-amendments-heading">
			<h2 id="hidden-amendments-heading">{ja.amendment.hiddenHeading}</h2>
			{#each data.hiddenAmendments as amendment (amendment.id)}
				<article>
					<h3>{amendment.location}</h3>
					<p class="notice">
						{#if amendment.status === 'hidden' && amendment.statusReason}{ja.post.hiddenStaff(ja.hideReasons[amendment.statusReason])}{:else}{ja.post.hiddenAuto}{/if}
					</p>
					<p class="body">{amendment.body}</p>
					{#if amendment.reason}<p class="body">{ja.amendment.reason}：{amendment.reason}</p>{/if}
					{#if data.staffHere && !amendment.mine}<p class="staff"><a href="/kanri?amendment={amendment.id}">{ja.post.staffLink}</a></p>{/if}
				</article>
			{/each}
		</section>
	{/if}
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

	.gone {
		margin: 0;
		padding: 0.5rem 0.75rem;
		border-radius: var(--radius-m);
		background: var(--color-surface);
		font-size: var(--font-size-sub);
	}

	.hidden-amendments {
		display: grid;
		gap: 0.75rem;
		padding-top: 1rem;
	}

	.hidden-amendments h2 {
		margin: 0;
		font-size: var(--font-size-body);
	}

	.hidden-amendments article {
		display: grid;
		gap: 0.5rem;
		padding: 1rem;
		border: 1px dashed var(--color-text-sub);
		border-radius: var(--radius-l);
	}

	.hidden-amendments h3 {
		margin: 0;
		color: var(--color-text-sub);
		font-size: var(--font-size-sub);
	}

	.hidden-amendments .notice {
		margin: 0;
		padding: 0.5rem 0.75rem;
		border-radius: var(--radius-m);
		background: var(--color-caution-bg);
		color: var(--color-caution);
		font-size: var(--font-size-sub);
	}

	.hidden-amendments .body {
		margin: 0;
		white-space: pre-line;
		overflow-wrap: anywhere;
	}

	.hidden-amendments .staff {
		margin: 0;
		font-size: var(--font-size-sub);
	}

	.hidden-amendments .staff a {
		display: inline-flex;
		align-items: center;
		min-height: var(--tap-min);
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
