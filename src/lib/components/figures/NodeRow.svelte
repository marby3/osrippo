<script lang="ts">
	// 図の並び（Issue #225）。アイコン・名前・ひとこと。arrows で矢印をはさみ、numbered で手順の番号を付ける。
	// stack のときは、置いた場所が狭い（30rem 未満）と縦に並べ、アイコンを左・文を右にする（言葉の途中で折り返さないように）
	import Arrow from './Arrow.svelte';
	import FigureIcon, { type IconName } from './FigureIcon.svelte';

	type Node = { icon: IconName; title: string; caption?: string };
	let { nodes, arrows = true, numbered = false, stack = true }: { nodes: readonly Node[]; arrows?: boolean; numbered?: boolean; stack?: boolean } = $props();
</script>

<div class="box" class:stack>
	<div class="row" class:gapped={!arrows}>
		{#each nodes as node, i (node.title)}
			{#if arrows && i > 0}<span class="sep"><Arrow /></span>{/if}
			<div class="node">
				<span class="mark">
					{#if numbered}<span class="num">{i + 1}</span>{/if}
					<FigureIcon name={node.icon} />
				</span>
				<span class="text">
					<span class="title">{node.title}</span>
					{#if node.caption}<span class="caption">{node.caption}</span>{/if}
				</span>
			</div>
		{/each}
	</div>
</div>

<style>
	.stack {
		container-type: inline-size;
	}

	.row {
		display: flex;
		align-items: stretch;
	}

	.gapped {
		gap: 0.5rem;
	}

	.sep {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0 0.125rem;
	}

	.node {
		display: flex;
		flex: 1 1 0;
		flex-direction: column;
		gap: 0.25rem;
		align-items: center;
		min-width: 0;
		padding: 0.625rem 0.25rem;
		border: 1px solid var(--color-input-border);
		border-radius: var(--radius-m);
		background: var(--color-bg);
		text-align: center;
		overflow-wrap: anywhere;
	}

	.mark {
		display: flex;
		gap: 0.25rem;
		align-items: center;
		color: var(--color-base);
	}

	.num {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.5rem;
		height: 1.5rem;
		border-radius: var(--radius-pill);
		background: var(--color-base);
		color: var(--color-bg);
		font-weight: bold;
	}

	.text {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
	}

	.title {
		font-size: var(--font-size-body);
		font-weight: bold;
	}

	.caption {
		color: var(--color-text-sub);
	}

	/* 狭いとき：縦に並べ、矢印は下向き。箱の中は アイコン｜名前とひとこと */
	@container (max-width: 30rem) {
		.row {
			flex-direction: column;
		}

		.sep {
			padding: 0.125rem 0;
		}

		.sep :global(.arrow) {
			transform: rotate(90deg);
		}

		.node {
			flex-direction: row;
			gap: 0.75rem;
			padding: 0.5rem 0.75rem;
			text-align: left;
		}
	}
</style>
