<script lang="ts">
	// 全体のメニュー（案 PcHeader・SpNav、Issue #85）。PC は上の帯にタブを並べ、スマホはタブを画面の下に固定する
	import { page } from '$app/state';
	import { ja } from '../copy/ja';
	import { TABS, tabOf, type Tab } from '../menu';

	/** 未読の数。ログインしていなければ null（ベルを出さない） */
	let { unread }: { unread: number | null } = $props();

	const current = $derived(tabOf(page.url.pathname));
	/** スマホの上の帯の見出し：タブの下のページはタブの名前、それ以外はサイト名 */
	const title = $derived(current === null || current === 'home' ? ja.siteName : ja.menu.tabs[current]);
</script>

{#snippet icon(key: Tab)}
	<svg viewBox="0 0 24 24" aria-hidden="true">
		{#if key === 'home'}
			<path d="M4 11 12 4l8 7v9h-5v-6h-6v6H4z" />
		{:else if key === 'kadai'}
			<path d="M5 5h14v10h-8l-4 4v-4H5z" />
		{:else if key === 'houan'}
			<path d="M7 3h7l4 4v14H7z" /><path d="M10 11h5M10 15h5" />
		{:else if key === 'saiketsu'}
			<path d="M5 5h14v14H5z" /><path d="m9 12 2 2 4-4" />
		{:else}
			<path d="M5 5a2 2 0 0 1 2-2h12v15H7a2 2 0 0 0-2 2z" /><path d="M5 20a2 2 0 0 0 2 1h12v-3" />
		{/if}
	</svg>
{/snippet}

<header>
	<div class="bar">
		<a class="brand" href="/">
			<span class="mark" aria-hidden="true">立</span>
			<span class="name">{ja.siteName}</span>
		</a>
		<span class="title" data-menu-title>{title}</span>

		<nav aria-label={ja.menu.label}>
			{#each TABS as tab (tab.key)}
				<a href={tab.href} aria-current={current === tab.key ? 'page' : undefined}>
					{@render icon(tab.key)}
					<span>{ja.menu.tabs[tab.key]}</span>
				</a>
			{/each}
		</nav>

		<div class="actions">
			{#if unread !== null}
				<!-- 先読みすると通知を開いたことになり、既読になってしまう -->
				<a class="bell" href="/tsuchi" aria-label={ja.notifications.entry(unread)} data-sveltekit-preload-data="off">
					<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 17V11a6 6 0 0 1 12 0v6l2 2H4z" /><path d="M10 21h4" /></svg>
					{#if unread > 0}<span class="count" aria-hidden="true">{unread}</span>{/if}
				</a>
			{/if}
			<a class="mine" href="/watashi">
				<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg>
				<span class="mine-label">{ja.menu.mine}</span>
			</a>
		</div>
	</div>
</header>

<style>
	header {
		border-bottom: 1px solid var(--color-divider);
		background: var(--color-bg);
	}

	.bar {
		display: flex;
		gap: 0.75rem;
		align-items: center;
		max-width: 72rem;
		min-height: 3.5rem;
		margin: 0 auto;
		padding: 0 1rem;
	}

	a {
		color: var(--color-text);
		text-decoration: none;
	}

	svg {
		width: 1.5rem;
		height: 1.5rem;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.75;
		stroke-linejoin: round;
		stroke-linecap: round;
	}

	.brand {
		display: flex;
		gap: 0.75rem;
		align-items: center;
		font-weight: 700;
	}

	.mark {
		display: grid;
		place-items: center;
		width: 2.25rem;
		height: 2.25rem;
		border-radius: var(--radius-m);
		background: var(--color-base);
		color: var(--color-bg);
		font-size: var(--font-size-heading);
	}

	/* スマホ：サイト名は見出しで、「わたしの記録」は人のアイコンで代わりにする（リンクの読み上げの名前には残す） */
	.name,
	.mine-label {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}

	.title {
		flex: 1;
		font-size: var(--font-size-heading);
		font-weight: 700;
	}

	.actions {
		display: flex;
		gap: 0.25rem;
		align-items: center;
	}

	.bell,
	.mine {
		display: inline-flex;
		position: relative;
		align-items: center;
		justify-content: center;
		min-width: var(--tap-min);
		min-height: var(--tap-min);
	}

	.count {
		position: absolute;
		top: 0.125rem;
		right: -0.25rem;
		min-width: 1.25rem;
		padding: 0 0.25rem;
		border: 2px solid var(--color-bg);
		border-radius: var(--radius-pill);
		background: var(--color-base);
		color: var(--color-bg);
		font-size: var(--font-size-min);
		font-weight: 700;
		line-height: 1.25rem;
		text-align: center;
	}

	/* スマホ：タブは画面の下に固定（SpNav）。いまのタブは太字と上の線 */
	nav {
		display: grid;
		position: fixed;
		z-index: 10;
		right: 0;
		bottom: 0;
		left: 0;
		grid-template-columns: repeat(5, 1fr);
		border-top: 1px solid var(--color-divider);
		background: var(--color-bg);
	}

	nav a {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		align-items: center;
		justify-content: center;
		/* 高さを変えたら +layout.svelte の .tab-space も */
		min-height: 3.5rem;
		border-top: 3px solid transparent;
		color: var(--color-text-sub);
		font-size: var(--font-size-min);
	}

	nav a[aria-current='page'] {
		border-top-color: var(--color-base);
		color: var(--color-text);
		font-weight: 700;
	}

	@media (min-width: 64rem) {
		.bar {
			gap: 1.5rem;
			min-height: 4rem;
		}

		.name,
		.mine-label {
			position: static;
			width: auto;
			height: auto;
			overflow: visible;
			clip-path: none;
		}

		.name {
			font-size: var(--font-size-heading);
		}

		.title {
			display: none;
		}

		/* PC：タブは上の帯に並べる（PcHeader）。いまのタブは太字と下の線 */
		nav {
			display: flex;
			position: static;
			flex: 1;
			align-self: stretch;
			gap: 0.25rem;
			border-top: 0;
		}

		nav a {
			flex-direction: row;
			padding: 0 0.875rem;
			border-top: 0;
			border-bottom: 3px solid transparent;
			color: var(--color-text);
			font-size: var(--font-size-body);
		}

		nav a[aria-current='page'] {
			border-bottom-color: var(--color-base);
		}

		nav svg {
			display: none;
		}

		.actions {
			gap: 1rem;
		}

		.mine {
			gap: 0.5rem;
			padding: 0 1rem;
			border: 1px solid var(--color-input-border);
			border-radius: var(--radius-m);
		}

		.mine svg {
			width: 1.25rem;
			height: 1.25rem;
		}

	}
</style>
