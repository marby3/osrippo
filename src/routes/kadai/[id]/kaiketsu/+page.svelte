<script lang="ts">
	import SolutionCard from '#lib/components/SolutionCard.svelte';
	import { ja } from '#lib/copy/ja.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const refusedSolution = $derived(form && 'solution' in form ? form.solution : null);
	const message = $derived(form && 'message' in form && refusedSolution === null ? form.message : undefined);
	/** 解決策への操作の知らせ（断った理由か、通報を受け付けたこと） */
	const solutionMessage = (id: number) => {
		if (!form || refusedSolution !== id) return undefined;
		if ('message' in form) return form.message;
		if ('reportMessage' in form) return form.reportMessage;
		return undefined;
	};
	const pageHref = (id: number, page: number) => (page > 1 ? `/kadai/${id}/kaiketsu?page=${page}` : `/kadai/${id}/kaiketsu`);
</script>

<svelte:head>
	{#if data.view === 'full'}
		<title>{ja.solution.listPageTitle(data.issue.title)}</title>
	{:else}
		<title>{ja.hidden.pageTitle}</title>
	{/if}
	{#if data.view !== 'full' || data.hidden}
		<meta name="robots" content="noindex" />
	{/if}
</svelte:head>

<main>
	{#if data.view === 'merged'}
		<p><a href="/kadai/{data.mergedInto}/kaiketsu">{ja.merge.mergedInto(data.mergedInto)}</a></p>
		{#if message}<p role="alert">{message}</p>{/if}
	{:else if data.view === 'hidden'}
		<h1>{ja.hidden.heading}</h1>
		<p>{data.status === 'auto_hidden' ? ja.hidden.auto : ja.hidden.staff(ja.hideReasons[data.statusReason ?? 'other'])}</p>
		<p><a href="/unei">{ja.hidden.toLog}</a></p>
	{:else}
		<p class="issue"><a href="/kadai/{data.issue.id}">{data.issue.title}</a></p>
		<h1>{ja.solution.listHeading}</h1>
		{#if !data.hidden}<p><a href="/kadai/{data.issue.id}/kaiketsu/kaku">{ja.solution.write}</a></p>{/if}
		{#if message}<p role="alert">{message}</p>{/if}
		{#if data.solutions.length === 0}<p>{ja.solution.empty}</p>{/if}
		{#each data.solutions as solution (solution.id)}
			<SolutionCard
				{solution}
				loggedIn={data.loggedIn}
				readonly={data.hidden}
				back={pageHref(data.issue.id, data.page)}
				message={solutionMessage(solution.id)}
				reported={data.reportedSolutions.includes(solution.id)}
				staff={data.staff}
			/>
		{/each}
		{#if data.hiddenSolutions.length}
			<h2>{ja.solution.hiddenHeading}</h2>
			{#each data.hiddenSolutions as solution (solution.id)}
				<SolutionCard
					{solution}
					loggedIn={data.loggedIn}
					readonly
					back={pageHref(data.issue.id, data.page)}
					staff={data.staff}
					notice={solution.status === 'auto_hidden'
						? ja.solution.hiddenAuto
						: ja.solution.hiddenStaff(ja.hideReasons[solution.statusReason ?? 'other'])}
				/>
			{/each}
		{/if}
		{#if data.page > 1 || data.hasNext}
			<nav class="pages">
				{#if data.page > 1}<a href={pageHref(data.issue.id, data.page - 1)}>{ja.solution.prevPage}</a>{/if}
				{#if data.hasNext}<a href={pageHref(data.issue.id, data.page + 1)}>{ja.solution.nextPage}</a>{/if}
			</nav>
		{/if}
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

	.issue {
		font-size: var(--font-size-sub);
	}

	.pages {
		display: flex;
		justify-content: space-between;
		margin-top: 1rem;
	}

	.pages a {
		display: inline-flex;
		align-items: center;
		min-height: var(--tap-min);
	}

	[role='alert'] {
		color: var(--color-caution);
	}
</style>
