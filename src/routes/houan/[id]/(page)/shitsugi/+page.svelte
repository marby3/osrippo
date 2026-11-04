<script lang="ts">
	// 法案の質疑のタブ（SpBillQA・PcBillQA）。スマホは 考え → 絞り込み → カード → 質疑を書く、PC はカードの右に考えと質疑を書く。
	// 同じものを2つ描かず、1つの要素を CSS の格子で動かす
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import QuestionCard from '#lib/components/QuestionCard.svelte';
	import { ja } from '#lib/copy/ja.ts';
	import type { Stance } from '#lib/domain/posts.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const base = $derived(`/houan/${data.bill.id}/shitsugi`);
	// ログインのあとで同じ絞り込みとページに戻る
	const here = $derived(page.url.pathname + page.url.search);
	/** 絞り込みの2ページ目以降で答弁すると、そのページが空になることがあるので、1ページ目へ移る */
	const afterReply = $derived(data.onlyWaiting && data.page > 1 ? `${base}?mati=1` : null);
	/** 失敗した答弁か補足（そのカードの欄に出す） */
	const failure = $derived(form?.question !== undefined ? { question: form.question, body: form.body ?? '', error: form.error, message: form.message } : null);
	const stanceMessage = $derived(form && 'stanceMessage' in form ? form.stanceMessage : undefined);
	const choices: Stance[] = ['for', 'undecided', 'against'];
	const nextHref = $derived(`${base}?${data.onlyWaiting ? 'mati=1&' : ''}page=${data.page + 1}`);
</script>

<svelte:head>
	<title>{ja.post.pageTitle(data.bill.title)}</title>
</svelte:head>

<div class="layout">
	{#if data.stanceShown}
		<section class="stance" aria-labelledby="stance-heading">
			<h2 id="stance-heading">{ja.post.stanceHeading}</h2>
			<p class="note">{ja.post.onlyYou}</p>
			<div class="choices">
				{#each choices as choice (choice)}
					{#if data.stance}
						<form method="post" action="?/stance" use:enhance={() => async ({ update }) => update({ reset: false })}>
							<input type="hidden" name="stance" value={choice} />
							<button aria-pressed={data.stance.stance === choice} disabled={data.stance.left === 0}>{ja.post.stances[choice]}</button>
						</form>
					{:else}
						<!-- ログインしていなければ、押すとログインの画面へ（選んだ内容は出さない） -->
						<form method="get" action="/login">
							<input type="hidden" name="next" value={here} />
							<button aria-pressed="false">{ja.post.stances[choice]}</button>
						</form>
					{/if}
				{/each}
			</div>
			{#if data.stance}
				<p class="note">{data.stance.left > 0 ? ja.post.stanceLeft(data.stance.left) : ja.post.stanceNone}</p>
			{/if}
			{#if stanceMessage}<p role="alert" class="alert">{stanceMessage}</p>{/if}
		</section>
	{/if}

	<div class="list">
		<nav class="filters" aria-label={ja.post.filters}>
			<a href={base} aria-current={data.onlyWaiting ? undefined : 'page'}>{ja.post.all}</a>
			<a href="{base}?mati=1" aria-current={data.onlyWaiting ? 'page' : undefined}>{ja.post.waitingCount(data.waitingCount)}</a>
		</nav>
		{#each data.questions as question (question.id)}
			<QuestionCard
				{question}
				role={data.role}
				loggedIn={data.loggedIn}
				waiting={data.waitUntil !== null}
				canAnswer={data.canAnswer}
				canSupplement={data.canSupplement}
				siteKey={data.siteKey}
				{failure}
				{afterReply}
				back={here}
			/>
		{:else}
			<p class="empty">{data.onlyWaiting ? ja.post.emptyWaiting : ja.post.empty}</p>
		{/each}
		{#if data.hasNext}<p class="more"><a href={nextHref}>{ja.post.more(data.totalCount)}</a></p>{/if}
	</div>

	{#if data.canQuestion}
		<div class="write">
			{#if data.waitUntil !== null}
				<p class="note">{ja.post.tooNew(data.waitUntil)}</p>
			{:else}
				<a href="{base}/kaku">{ja.post.writeQuestion}</a>
			{/if}
		</div>
	{/if}
</div>

<style>
	.layout {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 1.5rem;
		margin-top: 1.5rem;
	}

	h2 {
		margin: 0;
		font-size: var(--font-size-body);
	}

	.stance {
		padding: 1rem;
		border: 2px solid var(--color-base);
		border-radius: var(--radius-l);
	}

	.choices {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 0.5rem;
		margin-top: 0.75rem;
	}

	.choices button {
		width: 100%;
		min-height: var(--tap-min);
		border: 1px solid var(--color-text-sub);
		border-radius: var(--radius-m);
		background: var(--color-bg);
		color: var(--color-text);
		font: inherit;
	}

	.choices button[aria-pressed='true'] {
		border-color: var(--color-base);
		background: var(--color-base);
		color: var(--color-bg);
		font-weight: bold;
	}

	.choices button:disabled {
		opacity: 0.6;
	}

	.note,
	.empty {
		margin: 0.5rem 0 0;
		color: var(--color-text-sub);
		font-size: var(--font-size-sub);
	}

	.alert {
		margin: 0.5rem 0 0;
		color: var(--color-caution);
		font-size: var(--font-size-sub);
	}

	/* スマホの「質疑を書く」は、案（SpBillQA）のとおり画面の下に留める。一覧と同じ行に重ね、下端に置く */
	.list {
		grid-column: 1;
		grid-row: 2;
		display: grid;
		gap: 1rem;
		padding-bottom: calc(var(--tap-primary) + 1rem);
	}

	.stance {
		grid-row: 1;
	}

	.write {
		position: sticky;
		bottom: 0.5rem;
		grid-column: 1;
		grid-row: 2;
		align-self: end;
	}

	.filters {
		display: flex;
		gap: 0.5rem;
	}

	.filters a {
		display: inline-flex;
		align-items: center;
		min-height: var(--tap-min);
		padding: 0 1rem;
		border: 1px solid var(--color-text-sub);
		border-radius: var(--radius-pill);
		color: var(--color-text);
		text-decoration: none;
	}

	.filters a[aria-current='page'] {
		border-color: var(--color-base);
		background: var(--color-base);
		color: var(--color-bg);
	}

	.more {
		margin: 0;
	}

	.write a {
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

	@media (min-width: 64rem) {
		.layout {
			grid-template-columns: minmax(0, 1fr) 18.75rem;
			grid-template-rows: auto 1fr;
			column-gap: 3rem;
			align-items: start;
		}

		.list {
			grid-column: 1;
			grid-row: 1 / span 2;
			padding-bottom: 0;
		}

		.stance,
		.write {
			grid-column: 2;
		}

		.stance {
			grid-row: 1;
		}

		.write {
			position: static;
			grid-row: 2;
			align-self: start;
		}

		.choices {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
