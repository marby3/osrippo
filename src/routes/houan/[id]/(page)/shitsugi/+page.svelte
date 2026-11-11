<script lang="ts">
	import LegislatorNote from '#lib/components/LegislatorNote.svelte';
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
	/** 考えを変えられる残りの回数（スマホはボタンの下、PC は見出しの下に「自分だけに見えます」と並べる。Issue #122） */
	const stanceLeft = $derived(
		data.stance ? (data.stance.left > 0 ? ja.post.stanceLeft(data.stance.left) : ja.post.stanceNone) : null
	);
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
	/** 通報の結果（そのカードに出す） */
	const reportResult = $derived(form?.reportPost != null ? { post: form.reportPost, done: form.reportMessage, message: form.message } : null);
	const shownIds = $derived(new Set(data.questions.flatMap((q) => [q.id, ...q.answers.map((a) => a.id), ...q.supplements.map((s) => s.id)])));
	/** カードが消えたとき（3件目で非表示になった、開いたあとに質疑が非表示になった）は、結果を一覧の上に出す */
	const goneNotice = $derived.by(() => {
		if (reportResult && !shownIds.has(reportResult.post)) return reportResult.done ?? reportResult.message;
		if (failure?.question != null && !shownIds.has(failure.question)) return failure.message;
		return undefined;
	});
	const choices: Stance[] = ['for', 'undecided', 'against'];
	const nextHref = $derived(`${base}?${data.onlyWaiting ? 'mati=1&' : data.withRelated ? 'kanren=1&' : ''}page=${data.page + 1}`);
	/** 関連法案の質疑は読むだけ（Issue #69）。書くのと評価はその法案のページで行う */
	const relatedOf = (billId: number) => (billId === data.bill.id ? null : (data.relatedShown.find((r) => r.id === billId) ?? { id: billId, title: '' }));
</script>

<svelte:head>
	<title>{ja.post.pageTitle(data.bill.title)}</title>
</svelte:head>

<div class="layout">
	<!-- 議員は考えと評価を持たない（docs/spec/158.md の 3）。質疑は書ける -->
	{#if data.stanceShown && data.legislator}
		<LegislatorNote />
	{:else if data.stanceShown}
		<section class="stance" aria-labelledby="stance-heading">
			<!-- スマホは見出しの右に「自分だけに見えます」（SpBillQA）。PC は見出しの下に残りの回数と1行で（PcBillQA） -->
			<div class="stance-head">
				<h2 id="stance-heading">{ja.post.stanceHeading}</h2>
				<p class="note"><span>{ja.post.onlyYou}</span>{#if stanceLeft}<span class="left-pc">{ja.post.noteJoin}{stanceLeft}</span>{/if}</p>
			</div>
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
			{#if stanceLeft}<p class="note left-sp">{stanceLeft}</p>{/if}
			{#if stanceMessage}<p role="alert" class="alert">{stanceMessage}</p>{/if}
		</section>
	{/if}

	<div class="list">
		{#if goneNotice}<p role="status" class="gone">{goneNotice}</p>{/if}
		<nav class="filters" aria-label={ja.post.filters}>
			<a href={base} aria-current={data.onlyWaiting || data.withRelated ? undefined : 'page'}>{ja.post.all}</a>
			<a href="{base}?mati=1" aria-current={data.onlyWaiting ? 'page' : undefined}>{ja.post.waitingCount(data.waitingCount)}</a>
			{#if data.related.length}<a href="{base}?kanren=1" aria-current={data.withRelated ? 'page' : undefined}>{ja.post.withRelated}</a>{/if}
		</nav>
		{#each data.questions as question (question.id)}
			{@const relatedBill = relatedOf(question.billId)}
			{@const past = !relatedBill && question.sessionKey !== data.sessionKey}
			<QuestionCard
				{question}
				{relatedBill}
				role={relatedBill ? null : data.role}
				loggedIn={data.loggedIn}
				waiting={data.waitUntil !== null}
				canAnswer={!relatedBill && !past && data.canAnswer}
				canSupplement={!relatedBill && !past && data.canSupplement}
				{past}
				siteKey={data.siteKey}
				{failure}
				{afterReply}
				back={here}
				evaluationShown={!relatedBill && !past && data.evaluationShown && !data.legislator}
				{evaluationFailure}
				track={relatedBill || past ? null : track}
				staffHere={!relatedBill && data.staffHere}
				reportedIds={data.reportedIds}
				{reportResult}
			/>
		{:else}
			<p class="empty">{data.onlyWaiting ? ja.post.emptyWaiting : ja.post.empty}</p>
		{/each}
		{#if data.hasNext}<p class="more"><a href={nextHref}>{ja.post.more(data.totalCount)}</a></p>{/if}
		{#if data.mergedPosts.length}
			<section class="hidden-posts" aria-labelledby="merged-posts-heading">
				<h2 id="merged-posts-heading">{ja.post.mergedHeading}</h2>
				{#each data.mergedPosts as post (post.id)}
					<article>
						<p class="body">{post.body}</p>
						<p class="staff">
							{#if post.href}<a href={post.href}>{ja.post.mergedLink}</a>{:else}{ja.post.mergedTargetHidden}{/if}
						</p>
					</article>
				{/each}
			</section>
		{/if}
		{#if data.hiddenPosts.length}
			<section class="hidden-posts" aria-labelledby="hidden-posts-heading">
				<h2 id="hidden-posts-heading">{ja.post.hiddenHeading}</h2>
				{#each data.hiddenPosts as post (post.id)}
					<article>
						<h3>{ja.post.kinds[post.kind]}</h3>
						<p class="notice">
							{#if post.parentHidden}{ja.post.parentHidden}{:else if post.status === 'hidden' && post.statusReason}{ja.post.hiddenStaff(ja.hideReasons[post.statusReason])}{:else}{ja.post.hiddenAuto}{/if}
						</p>
						<p class="body">{post.body}</p>
						{#if data.staffHere && !post.mine && !post.parentHidden}<p class="staff"><a href="/kanri?post={post.id}">{ja.post.staffLink}</a></p>{/if}
					</article>
				{/each}
			</section>
		{/if}
	</div>

	{#if data.canQuestion || data.evaluationShown}
		<div class="write">
			{#if data.canQuestion}
				{#if data.electionStopped}
					<p class="note">{ja.election.stopped}</p>
				{:else if data.waitUntil !== null}
					<p class="note">{ja.post.tooNew(data.waitUntil)}</p>
				{:else}
					<a href="{base}/kaku">{ja.post.writeQuestion}</a>
				{/if}
			{/if}
			{#if data.evaluationShown && !data.legislator}<p class="hint">{ja.post.evaluationHint}</p>{/if}
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

	.stance-head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		column-gap: 0.5rem;
	}

	.stance-head .note {
		margin: 0;
	}

	.left-pc {
		display: none;
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
		/* 留めた「質疑を書く」の帯（ボタンと上下 0.5rem）の分と、その上の間 1rem */
		padding-bottom: calc(var(--tap-primary) + 2rem);
	}

	.stance {
		grid-row: 1;
	}

	/* 下のタブ（高さ 3.75rem、+layout.svelte の .tab-space と同じ）のすぐ上に、白い帯つきで留める（Issue #118） */
	.write {
		position: sticky;
		bottom: 3.75rem;
		padding: 0.5rem 0;
		border-top: 1px solid var(--color-divider);
		background: var(--color-bg);
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

	.gone {
		margin: 0;
		padding: 0.5rem 0.75rem;
		border-radius: var(--radius-m);
		background: var(--color-surface);
		font-size: var(--font-size-sub);
	}

	.hidden-posts {
		display: grid;
		gap: 0.75rem;
		padding-top: 1rem;
	}

	.hidden-posts article {
		display: grid;
		gap: 0.5rem;
		padding: 1rem;
		border: 1px dashed var(--color-text-sub);
		border-radius: var(--radius-l);
	}

	.hidden-posts h3 {
		margin: 0;
		color: var(--color-text-sub);
		font-size: var(--font-size-sub);
	}

	.hidden-posts .notice {
		margin: 0;
		padding: 0.5rem 0.75rem;
		border-radius: var(--radius-m);
		background: var(--color-caution-bg);
		color: var(--color-caution);
		font-size: var(--font-size-sub);
	}

	.hidden-posts .body {
		margin: 0;
		white-space: pre-line;
		overflow-wrap: anywhere;
	}

	.hidden-posts .staff {
		margin: 0;
		font-size: var(--font-size-sub);
	}

	.hidden-posts .staff a {
		display: inline-flex;
		align-items: center;
		min-height: var(--tap-min);
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
			padding: 0;
			border-top: 0;
			grid-row: 2;
			align-self: start;
		}

		.hint {
			display: block;
		}

		.choices {
			grid-template-columns: minmax(0, 1fr);
		}

		.stance-head {
			display: block;
		}

		.stance-head .note {
			margin-top: 0.25rem;
		}

		.left-pc {
			display: inline;
		}

		.left-sp {
			display: none;
		}

		/* 絞り込みと最初の質疑のあいだにも区切り線（PcBillQA）。質疑は1件ずつ下に線がある（QuestionCard） */
		.filters + :global(article) {
			border-top: 1px solid var(--color-divider);
		}
	}
</style>
