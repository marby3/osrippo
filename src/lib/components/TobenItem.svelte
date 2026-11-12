<!-- 答弁イベントの1行（一覧と、課題・法案のページの告知。Issue #153） -->
<script lang="ts">
	import { ja } from '../copy/ja';
	import type { TobenView } from '../server/toben';
	import PersonName from './PersonName.svelte';

	let { e, showState = false }: { e: TobenView; showState?: boolean } = $props();
</script>

<li>
	<a class="title" href="/toben/{e.id}">{e.title}</a>
	{#if showState && (e.state === 'cancelled' || e.state === 'stopped')}<span class="state">{ja.toben.states[e.state]}</span>{/if}
	<p class="meta">
		<PersonName person={e.person} /> ・ {ja.toben.when(e.startsAt, e.endsAt)}
	</p>
	<p class="meta">
		{ja.toben.target[e.targetKind]}：{#if e.targetTitle}<a href={e.targetKind === 'issue' ? `/kadai/${e.targetId}` : `/houan/${e.targetId}`}>{e.targetTitle}</a>{:else}{ja.toben.targetMissing}{/if}
	</p>
</li>

<style>
	li {
		padding: 0.75rem 0;
		border-bottom: 1px solid var(--color-divider);
	}

	.title {
		font-weight: 700;
		color: var(--color-text);
	}

	.state {
		margin-left: 0.5rem;
		padding: 0.125rem 0.5rem;
		border-radius: var(--radius-s);
		background: var(--color-surface);
		font-size: var(--font-size-sub);
	}

	.meta {
		margin: 0.25rem 0 0;
		color: var(--color-text-sub);
		font-size: var(--font-size-sub);
	}
</style>
