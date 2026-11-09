<script lang="ts">
	// 法令ページの目次（SpLaw・PcLaw）。現実の法律と IF世界の法律で同じものを使う（Issue #124）。
	// PC は左にいつも出し、スマホは「目次から探す」で開く。
	// いま画面のいちばん上に出ている章（節）に aria-current を付けて太字にする（スクリプトがないときは付けない）
	import { onMount } from 'svelte';
	import { ja } from '#lib/copy/ja.ts';
	import type { tableOfContents } from '#lib/domain/law/display.ts';

	type Item = ReturnType<typeof tableOfContents>[number];
	let { items }: { items: Item[] } = $props();

	let open = $state(false);
	/** いまの見出し（目次の項目そのものと比べるので、プロキシにしない） */
	let current = $state.raw<Item | null>(null);

	/** 条を持つ見出しを、文書の順（親が先、子があと）に並べる */
	const flatten = (list: Item[]): Item[] => list.flatMap((h) => [h, ...flatten(h.children)]);
	const entries = $derived(flatten(items).filter((h) => h.first !== null));

	/** 見出しの最初の条がこの線（画面の上からの px）より上に来たら、その見出しの中にいるとみなす */
	const LINE = 120;

	function update() {
		// ページの下まで送ったら、最後の章が短くても線まで上がらないので、画面に見えている最後の見出しにする
		const bottom = scrollY + innerHeight >= document.documentElement.scrollHeight - 2;
		const line = bottom ? innerHeight : LINE;
		let found: Item | null = null;
		for (const h of entries) {
			const el = document.getElementById(`jo-${h.first}`);
			// 親と子の最初の条が同じなら、あとに並ぶ子（節）が勝つ
			if (el && el.getBoundingClientRect().top <= line) found = h;
		}
		current = found ?? entries[0] ?? null;
	}

	// 同じ部品のまま別の法令へ移ったときも、いまの見出しを決め直す（画面が描き変わったあと）
	$effect(() => {
		void entries;
		const frame = requestAnimationFrame(update);
		return () => cancelAnimationFrame(frame);
	});

	onMount(() => {
		let frame = 0;
		const schedule = () => {
			if (!frame)
				frame = requestAnimationFrame(() => {
					frame = 0;
					update();
				});
		};
		update();
		addEventListener('scroll', schedule, { passive: true });
		addEventListener('resize', schedule);
		return () => {
			removeEventListener('scroll', schedule);
			removeEventListener('resize', schedule);
			cancelAnimationFrame(frame);
		};
	});
</script>

{#snippet list(level: Item[])}
	<ul>
		{#each level as h, i (i)}
			<li>
				{#if h.first}
					<a href="#jo-{h.first}" aria-current={current === h ? 'location' : undefined} onclick={() => (open = false)}>{h.title}</a>
				{:else}
					<span>{h.title}</span>
				{/if}
				{#if h.children.length}{@render list(h.children)}{/if}
			</li>
		{/each}
	</ul>
{/snippet}

<div class="toc">
	<button class="toggle" aria-expanded={open} aria-controls="toc" onclick={() => (open = !open)}>{ja.law.openToc}</button>
	<nav id="toc" aria-labelledby="toc-title" class:shown={open}>
		<h2 id="toc-title">{ja.law.toc}</h2>
		{@render list(items)}
	</nav>
</div>

<style>
	.toggle {
		min-height: var(--tap-min);
		margin-bottom: 1rem;
		padding: 0;
		border: 0;
		background: none;
		color: var(--color-link);
		font: inherit;
		text-decoration: underline;
	}

	/* スマホは「目次から探す」で開く */
	nav {
		display: none;
		margin-bottom: 1.5rem;
	}

	nav.shown {
		display: block;
	}

	h2 {
		color: var(--color-text-sub);
		font-size: var(--font-size-sub);
	}

	ul {
		margin: 0;
		padding-left: 1em;
		list-style: none;
	}

	nav > ul {
		padding-left: 0;
	}

	li {
		padding: 0.25rem 0;
	}

	a {
		color: var(--color-text);
		text-decoration: none;
	}

	/* いまの章（節）を太字に */
	a[aria-current] {
		font-weight: bold;
	}

	/* PC は左に目次をいつも出す */
	@media (min-width: 64rem) {
		.toggle {
			display: none;
		}

		nav {
			display: block;
			position: sticky;
			top: 1rem;
			max-height: calc(100vh - 2rem);
			overflow-y: auto;
		}
	}
</style>
