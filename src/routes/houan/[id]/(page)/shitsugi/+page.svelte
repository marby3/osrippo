<script lang="ts">
	// 法案の質疑のタブ（SpBillQA・PcBillQA）。スマホは 考え → 絞り込み → カード → 質疑を書く、PC はカードの右に考えと質疑を書く。
	// 同じものを2つ描かず、1つの要素を CSS の格子で動かす
	import { enhance } from '$app/forms';
	import { beforeNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import QuestionCard from '#lib/components/QuestionCard.svelte';
	import { createReadTracker } from '#lib/components/read-tracker.ts';
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
	/** 断られた評価（そのボタンの下に出す） */
	const evaluationFailure = $derived(form && 'evaluationPost' in form && form.evaluationPost != null ? { post: form.evaluationPost, message: form.message ?? '' } : null);
	// 読んだ記録：応答は画面に出さない。失敗しても黙って捨てる（docs/spec/67.md 決めたこと4）
	const tracker = createReadTracker((ids) => {
		fetch(`${base}?/read`, {
			method: 'POST',
			headers: { 'x-sveltekit-action': 'true' },
			body: new URLSearchParams(ids.map((id) => ['post', String(id)])),
			keepalive: true
		}).catch(() => {});
	});
	onMount(() => tracker.start());
	// 同じ画面のまま別の法案へ移ると送り先が変わるので、移る前に送る
	beforeNavigate(() => tracker.flush());
	const track = $derived(data.loggedIn && data.evaluationShown ? tracker : null);
	const choices: Stance[] = ['for', 'undecided', 'against'];
	const nextHref = $derived(`${base}?${data.onlyWaiting ? 'mati=1&' : data.withRelated ? 'kanren=1&' : ''}page=${data.page + 1}`);
	/** 関連法案の質疑は読むだけ（Issue #69）。書くのと評価はその法案のページで行う */
	const relatedOf = (billId: number) => data.related.find((r) => r.id === billId) ?? null;
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
			<a href={base} aria-current={data.onlyWaiting || data.withRelated ? undefined : 'page'}>{ja.post.all}</a>
			<a href="{base}?mati=1" aria-current={data.onlyWaiting ? 'page' : undefined}>{ja.post.waitingCount(data.waitingCount)}</a>
			{#if data.related.length}<a href="{base}?kanren=1" aria-current={data.withRelated ? 'page' : undefined}>{ja.post.withRelated}</a>{/if}
		</nav>
		{#each data.questions as question (question.id)}
			{@const relatedBill = relatedOf(question.billId)}
			<QuestionCard
				{question}
				{relatedBill}
				role={relatedBill ? null : data.role}
				loggedIn={data.loggedIn}
				waiting={data.waitUntil !== null}
				canAnswer={!relatedBill && data.canAnswer}
				canSupplement={!relatedBill && data.canSupplement}
				siteKey={data.siteKey}
				{failure}
				{afterReply}
				back={here}
				evaluationShown={!relatedBill && data.evaluationShown}
				{evaluationFailure}
				track={relatedBill ? null : track}
			/>
		{:else}
			<p class="empty">{data.onlyWaiting ? ja.post.emptyWaiting : ja.post.empty}</p>
		{/each}
		{#if data.hasNext}<p class="more"><a href={nextHref}>{ja.post.more(data.totalCount)}</a></p>{/if}
	</div>

	{#if data.canQuestion || data.evaluationShown}
		<div class="write">
			{#if data.canQuestion}
				{#if data.waitUntil !== null}
					<p class="note">{ja.post.tooNew(data.waitUntil)}</p>
				{:else}
					<a href="{base}/kaku">{ja.post.writeQuestion}</a>
				{/if}
			{/if}
			{#if data.evaluationShown}<p class="hint">{ja.post.evaluationHint}</p>{/if}
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
		flex-wrap: wrap;
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

	/* 案（PcBillQA）の右の列の説明文。スマホの案にはない */
	.hint {
		display: none;
		margin: 1rem 0 0;
		color: var(--color-text-sub);
		font-size: var(--font-size-sub);
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

		.hint {
			display: block;
		}

		.choices {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
