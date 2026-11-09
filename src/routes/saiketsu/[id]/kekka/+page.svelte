<script lang="ts">
	// 採決の結果（SpResult・PcResult）。帯グラフは色だけで示さない（反対は斜線、棄権は白で、数も出す）。
	// 参考の票はスマホでは開閉し、PC は最初から出す。見出しの文字は1か所に置き、開くボタンはその上に重ねる
	import Crumbs from '#lib/components/Crumbs.svelte';
	import { ja } from '#lib/copy/ja.ts';
	import { VOTE_CHOICES } from '#lib/domain/votes.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const total = $derived(data.phase === 'done' ? data.counted.yes + data.counted.no + data.counted.abstain : 0);
	let opened = $state(false);
	/** 可決のときは、反映済み・要調整（理由ごと）・期限切れ・手続き中で文言が変わる（docs/spec/72.md 決めたこと8） */
	const note = $derived.by(() => {
		if (data.phase !== 'done') return '';
		if (data.outcome === 'rejected') return ja.result.rejectedNote;
		if (data.voidedNote !== null) return ja.review.voided;
		if (data.outcome === 'lapsed') return ja.result.lapsedNote(data.quorum);
		const a = data.adjustment;
		if (a) {
			if (a.reason === 'repealed') return ja.ifLaw.repealedNote;
			return data.now < a.dueAt ? ja.ifLaw.adjusting[a.reason] : ja.ifLaw.expired;
		}
		return data.places.length ? ja.result.passedNote : ja.ifLaw.applying;
	});
	const dueShown = $derived(data.phase === 'done' && data.adjustment !== null && data.adjustment.reason !== 'repealed' && data.now < data.adjustment.dueAt);
</script>

<svelte:head>
	<title>{ja.result.pageTitle(data.bill.title)}</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<main>
	<Crumbs current={ja.result.crumb(data.session)} keepOnSp />
	<h1>{data.bill.title}</h1>

	{#if data.phase === 'withdrawn'}
		<p class="waiting">{ja.bill.withdraw.result}</p>
	{:else if data.phase === 'before'}
		<p class="waiting">{ja.result.before}</p>
		<p class="deadline">{ja.vote.deadline(data.session)}</p>
	{:else if data.phase === 'counting'}
		<p class="waiting">{ja.result.counting}</p>
	{:else if data.phase === 'reviewing'}
		<p class="waiting">{ja.review.reviewing}</p>
	{:else}
		<div class="layout">
			<div class="content">
				<section class="verdict" class:passed={data.outcome === 'passed'}>
					<p class="word">{ja.result.words[data.outcome]}</p>
					<p class="note">{note}</p>
					{#if data.voidedNote}<p class="due">{ja.review.voidedReason(data.voidedNote)}</p>{/if}
					{#if dueShown}<p class="due">{ja.ifLaw.due(data.adjustment!.dueAt)}</p>{/if}
				</section>
				{#if data.comparison === 'reversed'}<p class="reversed">{ja.result.reversed}</p>{/if}
				<p class="notice">{ja.result.notice}</p>

				<section class="counts">
					<h2>{ja.result.counted(total)}</h2>
					{#if total}
						<div class="bar" aria-hidden="true">
							{#each VOTE_CHOICES as choice (choice)}
								{#if data.counted[choice]}<span class={choice} style:flex-grow={data.counted[choice]}></span>{/if}
							{/each}
						</div>
					{/if}
					<dl>
						{#each VOTE_CHOICES as choice (choice)}
							<div>
								<dt>{ja.result.choices[choice]}</dt>
								<dd>{data.counted[choice]}</dd>
							</div>
						{/each}
					</dl>
				</section>

				{#if data.amendments.length}
					<section class="amendments">
						<h2>{ja.result.amendmentsHeading}</h2>
						<ul>
							{#each data.amendments as a (a.id)}
								<li>{ja.result.amendmentRow(a.location, ja.amendment.statuses[a.status])}</li>
							{/each}
						</ul>
						<p><a href="/houan/{data.bill.id}/shusei">{ja.result.amendmentsLink}</a></p>
					</section>
				{/if}
			</div>

			<aside>
				<section class="reference">
					<h2>{ja.result.referenceHeading}</h2>
					<button type="button" class="opener" class:opened aria-label={ja.result.referenceOpen} aria-expanded={opened} onclick={() => (opened = !opened)}>
						<svg class:up={opened} viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" /></svg>
					</button>
					<div class="panel" class:opened>
						<p>{ja.result.referenceLine(data.reference.yes, data.reference.no, data.reference.abstain)}</p>
						{#if data.comparison === 'same'}<p class="same">{ja.result.same}</p>{/if}
					</div>
				</section>
				{#each data.places as place (place.lawId)}
					<p class="to-bill"><a href="/if/hourei/{place.lawId}">{data.places.length > 1 ? ja.ifLaw.toLawNamed(place.title) : ja.ifLaw.toLaw}</a></p>
				{/each}
				<p class="to-bill"><a href="/houan/{data.bill.id}">{ja.result.billLink}</a></p>
				{#if data.resubmittable}<p class="to-bill"><a href="/houan/{data.bill.id}">{ja.bill.resubmit.fromResult}</a></p>{/if}
			</aside>
		</div>
	{/if}
	{#if data.phase !== 'done'}<p class="to-bill"><a href="/houan/{data.bill.id}">{ja.result.billLink}</a></p>{/if}
	<p class="to-bill"><a href="/iinkai">{ja.chair.link}</a></p>
</main>

<style>
	main {
		/* 全体のメニューと同じ幅。PC で本文の左右の端がメニューとそろう（Issue #119） */
		max-width: 72rem;
		margin: 0 auto;
		padding: 1rem;
	}

	.deadline {
		color: var(--color-text-sub);
		font-size: var(--font-size-sub);
	}

	h1 {
		margin: 0.5rem 0 1rem;
		font-size: var(--font-size-page-title);
		overflow-wrap: anywhere;
	}

	h2 {
		margin: 0;
		font-size: var(--font-size-heading);
	}

	.waiting {
		font-weight: bold;
	}

	.verdict {
		padding: 1.5rem 1rem;
		border: 2px solid var(--color-input-border);
		border-radius: var(--radius-l);
		text-align: center;
	}

	.verdict.passed {
		border-color: var(--color-base);
	}

	.word {
		margin: 0;
		color: var(--color-base);
		font-size: calc(var(--font-size-page-title) * 1.75);
		font-weight: bold;
		line-height: 1.2;
	}

	.note {
		margin: 0.5rem 0 0;
		font-weight: bold;
	}

	.due {
		margin: 0.5rem 0 0;
		font-size: var(--font-size-sub);
	}

	.notice,
	.reversed {
		margin: 1rem 0 0;
		padding: 0.75rem 1rem;
		border: 1px solid var(--color-caution);
		border-radius: var(--radius-m);
		background: var(--color-caution-bg);
	}

	.reversed {
		font-weight: bold;
	}

	.counts,
	.amendments {
		margin-top: 1.5rem;
	}

	.bar {
		display: flex;
		height: 1.5rem;
		margin-top: 0.5rem;
		overflow: hidden;
		border: 1px solid var(--color-text);
		border-radius: var(--radius-s);
	}

	.bar span {
		flex-basis: 0;
	}

	.bar .yes {
		background: var(--color-support);
	}

	.bar .no {
		background-image: repeating-linear-gradient(135deg, var(--color-oppose) 0 6px, var(--color-del-text) 6px 12px);
	}

	.bar .abstain {
		background: var(--color-bg);
	}

	dl {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		margin: 0.75rem 0 0;
		text-align: center;
	}

	dt {
		font-size: var(--font-size-sub);
	}

	dd {
		margin: 0;
		font-size: var(--font-size-page-title);
		font-weight: bold;
	}

	.amendments ul {
		margin: 0.5rem 0;
		padding-left: 1.25rem;
	}

	.amendments h2 {
		font-size: var(--font-size-body);
	}

	aside {
		margin-top: 1.5rem;
	}

	/* スマホは見出しの行全体を押せるようにする。PC は開閉しない */
	.reference {
		position: relative;
		padding: 1rem;
		border: 1px solid var(--color-input-border);
		border-radius: var(--radius-l);
	}

	.reference h2 {
		padding-right: 2rem;
		font-size: var(--font-size-body);
	}

	.opener {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: flex-start;
		justify-content: flex-end;
		padding: 1rem;
		border: none;
		border-radius: var(--radius-l);
		background: none;
		color: var(--color-text);
	}

	/* 開いたら見出しの行だけを押せるようにする（参考の票の文字を選べるように） */
	.opener.opened {
		bottom: auto;
		height: var(--tap-primary);
	}

	.opener svg.up {
		transform: rotate(180deg);
	}

	.panel {
		display: none;
	}

	.panel.opened {
		display: block;
	}

	.panel p {
		margin: 0.5rem 0 0;
	}

	.same {
		color: var(--color-text-sub);
		font-size: var(--font-size-sub);
	}

	.to-bill {
		margin-top: 1rem;
	}

	@media (min-width: 64rem) {
		.layout {
			display: grid;
			grid-template-columns: minmax(0, 1fr) 19rem;
			gap: 3rem;
			align-items: start;
		}

		aside {
			margin-top: 0;
		}

		.verdict {
			display: flex;
			gap: 1.5rem;
			align-items: center;
			text-align: left;
		}

		.note {
			margin: 0;
		}

		dl {
			display: flex;
			gap: 3rem;
			text-align: left;
		}

		.opener {
			display: none;
		}

		.reference h2 {
			padding-right: 0;
		}

		.panel {
			display: block;
		}
	}
</style>
