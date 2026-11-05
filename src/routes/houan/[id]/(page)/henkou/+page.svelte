<script lang="ts">
	// 法案の変更点（SpBillChanges・PcBillChanges）。スマホは「いま」と「変更後」を縦に、PC は「場所・変更後・いま」の表。
	// 変更点は色だけで示さない：削除は取り消し線と「−」、追加は下線と「＋」（DiffText）
	import DiffText from '#lib/components/DiffText.svelte';
	import { ja } from '#lib/copy/ja.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const bill = $derived(data.bill);
</script>

<svelte:head>
	<title>{ja.bill.page.changesPageTitle(bill.title)}</title>
	<!-- 架空の条文を出すので検索に載せない（docs/spec/72.md の F） -->
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="changes">
	{#if data.changes.length}
		<p class="legend" aria-hidden="true">
			<span class="del">{ja.bill.page.legendDel}</span>
			<span class="ins">{ja.bill.page.legendIns}</span>
		</p>
	{/if}

	{#each bill.repealed as title (title)}
		<p class="repeal">{ja.bill.page.repeal(title)}</p>
	{/each}

	{#if data.changes.length}
		<div class="head" aria-hidden="true">
			<span>{ja.bill.page.place}</span><span>{ja.bill.page.after}</span><span>{ja.bill.page.before}</span>
		</div>
	{/if}
	{#each data.changes as change, i (i)}
		{@const supplementary = change.op === 'supplementary'}
		<article>
			<h2>
				{supplementary
					? ja.bill.page.changeHeading(null, ja.bill.page.supplementary, ja.bill.ops.supplementary)
					: ja.bill.page.changeHeading(i + 1, change.location, ja.bill.ops[change.op])}
			</h2>
			<!-- 新しく足すものは、スマホでは変更後だけ（SpBillChanges）、PC は表の欄に（なし）（PcBillChanges） -->
			<section class="before" class:empty={!change.before}>
				<h3>{ja.bill.page.before}</h3>
				{#if change.before}<DiffText parts={change.before} show="removed" />{:else}<p class="none">{ja.bill.page.none}</p>{/if}
			</section>
			<section class="after">
				<h3>{ja.bill.page.after}</h3>
				{#if change.after}<DiffText parts={change.after} show="added" />{:else}<p class="none">{ja.bill.page.deleted}</p>{/if}
			</section>
		</article>
	{/each}
</div>

<style>
	.changes {
		display: grid;
		gap: 1rem;
		margin-top: 1rem;
	}

	.legend {
		display: flex;
		gap: 1rem;
		margin: 0;
		font-size: var(--font-size-sub);
	}

	.legend .del {
		background: var(--color-del-bg);
		color: var(--color-del-text);
		text-decoration: line-through;
	}

	.legend .ins {
		background: var(--color-ins-bg);
		color: var(--color-ins-text);
		text-decoration: underline;
	}

	.repeal {
		margin: 0;
		padding: 1rem;
		border: 1px solid var(--color-input-border);
		border-radius: var(--radius-l);
	}

	.head {
		display: none;
	}

	article {
		border: 1px solid var(--color-input-border);
		border-radius: var(--radius-l);
		overflow: hidden;
	}

	h2 {
		margin: 0;
		padding: 0.75rem 1rem;
		border-bottom: 1px solid var(--color-input-border);
		background: var(--color-surface);
		font-size: var(--font-size-body);
	}

	section {
		padding: 0 1rem;
	}

	.before + .after {
		border-top: 1px dashed var(--color-divider);
	}

	h3 {
		margin: 0.75rem 0 0;
		color: var(--color-text-sub);
		font-size: var(--font-size-sub);
	}

	.none {
		color: var(--color-text-sub);
	}

	.empty {
		display: none;
	}

	.empty + .after {
		border-top: none;
	}

	.empty + .after h3 {
		display: none;
	}

	@media (min-width: 64rem) {
		.changes {
			gap: 0;
		}

		.legend {
			margin-bottom: 1rem;
		}

		.head,
		article {
			display: grid;
			grid-template-columns: 12rem 1fr 1fr;
		}

		.head {
			border: 1px solid var(--color-input-border);
			border-radius: var(--radius-l) var(--radius-l) 0 0;
			background: var(--color-surface);
			font-weight: bold;
		}

		.head span {
			padding: 0.75rem 1rem;
		}

		.head span + span {
			border-left: 1px solid var(--color-divider);
		}

		article {
			border-top: none;
			border-radius: 0;
		}

		article:last-child {
			border-radius: 0 0 var(--radius-l) var(--radius-l);
		}

		h2 {
			border-bottom: none;
			background: none;
			font-size: var(--font-size-sub);
		}

		section {
			border-left: 1px solid var(--color-divider);
		}

		.before + .after {
			border-top: none;
		}

		.after {
			grid-column: 2;
			grid-row: 1;
		}

		.before {
			display: block;
			grid-column: 3;
			grid-row: 1;
		}

		.empty + .after h3 {
			display: block;
		}

		/* 見出しの行（場所・変更後・いま）があるので、欄の中の名前は読み上げだけにする */
		h3 {
			position: absolute;
			width: 1px;
			height: 1px;
			overflow: hidden;
			clip-path: inset(50%);
			white-space: nowrap;
		}
	}
</style>
