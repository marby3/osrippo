<script lang="ts">
	// 通知の一覧（docs/spec/78.md 決めたこと9）。画面の案はない。未読は色だけで示さず「未読」の文字を出す。
	// 架空の法案の「可決」が並ぶので、帯を付ける
	import { ja } from '#lib/copy/ja.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>{ja.notifications.pageTitle}</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<main>
	<h1>{ja.notifications.heading}</h1>
	{#if data.items.length === 0}
		<p>{ja.notifications.empty}</p>
	{:else}
		<ul>
			{#each data.items as item, i (i)}
				<li class:unread={item.unread}>
					{#if item.unread}<span class="mark">{ja.notifications.unread}</span>{/if}
					<a href={item.href}>{ja.notifications.kinds[item.kind](item.title ?? '')}</a>
					<time datetime={new Date(item.at).toISOString()}>{ja.notifications.at(item.at)}</time>
				</li>
			{/each}
		</ul>
	{/if}
	{#if data.hasNext}<p><a href="/tsuchi?page={data.page + 1}" data-sveltekit-preload-data="off">{ja.notifications.nextPage}</a></p>{/if}
</main>

<style>
	main {
		max-width: 47rem;
		margin: 0 auto;
		padding: 1rem;
	}

	h1 {
		margin: 0.5rem 0 1rem;
		font-size: var(--font-size-page-title);
	}

	ul {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	li {
		display: grid;
		gap: 0.25rem;
		padding: 0.75rem 0;
		border-bottom: 1px solid var(--color-divider);
		overflow-wrap: anywhere;
	}

	li.unread a {
		font-weight: bold;
	}

	.mark {
		width: fit-content;
		padding: 0 0.5rem;
		border-radius: var(--radius-m);
		background: var(--color-base);
		color: var(--color-bg);
		font-size: var(--font-size-min);
		font-weight: bold;
	}

	time {
		color: var(--color-text-sub);
		font-size: var(--font-size-sub);
	}
</style>
