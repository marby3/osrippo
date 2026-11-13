<script lang="ts">
	// β版のお約束（Issue #200）。案がないので、遊び方のページ（#131）の幅と見出しにそろえる
	import { ja } from '#lib/copy/ja.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const t = ja.yakusoku;
</script>

<svelte:head>
	<title>{t.pageTitle}</title>
</svelte:head>

<main class="frame">
	<h1>{t.heading}</h1>
	<p class="lead">{t.lead}</p>
	<ol class="items">
		{#each t.items as item (item)}<li>{item}</li>{/each}
	</ol>

	{#if data.agreedAt !== null}
		<p class="agreed">{t.agreed(data.agreedAt)}</p>
	{:else if data.loggedIn}
		<!-- 同意はふつうのフォーム（スクリプトなしでも動く）。記録したら元の画面へ戻る -->
		<form method="post" class="agree">
			<p class="ask">{t.ask}</p>
			{#if form?.message}<p role="alert">{form.message}</p>{/if}
			<input type="hidden" name="version" value={data.version} />
			<input type="hidden" name="next" value={data.next} />
			<button>{t.agree}</button>
			<p class="note">{t.backNote}</p>
		</form>
	{/if}
</main>

<style>
	main {
		max-width: 40rem;
		padding-top: 1.5rem;
		padding-bottom: 2rem;
	}

	h1 {
		margin: 0;
		font-size: var(--font-size-page-title);
	}

	.lead {
		margin: 0.5rem 0 1rem;
	}

	.items {
		display: grid;
		gap: 0.75rem;
		margin: 0 0 1.5rem;
		padding-left: 1.5rem;
	}

	.agreed {
		margin: 0;
		padding: 0.75rem 1rem;
		border-radius: var(--radius-m);
		background: var(--color-surface);
	}

	.agree {
		display: grid;
		gap: 0.5rem;
		padding: 1rem;
		border: 1px solid var(--color-divider);
		border-radius: var(--radius-l);
	}

	.agree p {
		margin: 0;
	}

	.ask {
		font-weight: bold;
	}

	[role='alert'] {
		color: var(--color-caution);
	}

	button {
		min-height: var(--tap-primary);
		border: none;
		border-radius: var(--radius-l);
		background: var(--color-base);
		color: var(--color-bg);
		font: inherit;
		font-weight: bold;
	}

	.note {
		color: var(--color-text-sub);
		font-size: var(--font-size-sub);
	}
</style>
