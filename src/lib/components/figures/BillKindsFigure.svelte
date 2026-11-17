<script lang="ts">
	// 法案の書き方「法案の種類」の図（Issue #225）：改正・廃止・制定を、法令の紙の絵で示す。
	// 変わるところは色だけで示さない：削除は取り消し線と「−」、追加は下線と「＋」（DiffText と同じ）
	import { ja } from '#lib/copy/ja.ts';
	import Figure from './Figure.svelte';
	import FigureIcon from './FigureIcon.svelte';

	const t = ja.figures.kinds;
</script>

<Figure label={t.label}>
	<div class="kinds">
		{#each t.items as k (k.kind)}
			<div class="kind">
				<span class="title"><FigureIcon name={k.kind} />{k.title}</span>
				<div class="paper" class:repealed={k.kind === 'repeal'} class:enacted={k.kind === 'enact'}>
					<!-- 廃止は法令名ごと削除、制定は法令名ごと追加 -->
					{#if k.kind === 'repeal'}<del class="heading">{t.del}{k.heading}</del>
					{:else if k.kind === 'enact'}<ins class="heading">{t.ins}{k.heading}</ins>
					{:else}<span class="heading">{k.heading}</span>{/if}
					{#each k.lines as line, i (i)}
						{#if 'del' in line}<del>{t.del}{line.del}</del>{:else}<ins>{t.ins}{line.ins}</ins>{/if}
					{/each}
				</div>
				<span class="caption">{k.caption}</span>
			</div>
		{/each}
	</div>
</Figure>

<style>
	.kinds {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.5rem;
	}

	.kind {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		align-items: stretch;
		min-width: 0;
		text-align: center;
	}

	.title {
		display: flex;
		gap: 0.25rem;
		align-items: center;
		justify-content: center;
		color: var(--color-base);
		font-size: var(--font-size-body);
		font-weight: bold;
	}

	/* 法令の紙：右上の角を折った形 */
	.paper {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		align-items: flex-start;
		padding: 0.5rem;
		border: 1px solid var(--color-input-border);
		border-radius: var(--radius-s) var(--radius-l) var(--radius-s) var(--radius-s);
		background: var(--color-bg);
		text-align: left;
		overflow-wrap: anywhere;
	}

	/* 廃止は紙ごと点線（まるごとなくなる） */
	.repealed {
		border-style: dashed;
	}

	/* 制定は新しい紙（線を太く） */
	.enacted {
		border-width: 2px;
		border-color: var(--color-base);
	}

	.heading {
		font-weight: bold;
	}

	del {
		background: var(--color-del-bg);
		color: var(--color-del-text);
		text-decoration: line-through;
	}

	ins {
		background: var(--color-ins-bg);
		color: var(--color-ins-text);
		text-decoration: underline;
	}

	.caption {
		color: var(--color-text-sub);
		overflow-wrap: anywhere;
	}
</style>
