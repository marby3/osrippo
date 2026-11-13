<script lang="ts">
	// 条のカード（Issue #165。案 SpLawCard・PcLawCard）。本文の「特商法9条」のリンクを押すと、ページを離れずに条文を読める。
	// 全体の枠に1つだけ置き、押されたリンク（law-card.svelte.ts）の条を /hourei/[lawId]/[num]/card から読む。
	// PC はリンクのすぐ下に出す小さな枠、スマホは下から出るシート。ブラウザの popover で開く（Esc と枠の外で閉じる）
	import { afterNavigate } from '$app/navigation';
	import { ja } from '../copy/ja';
	import { articleLabel } from '../domain/law/parse';
	import type { ArticleCard } from '../server/law-refs';
	import { canPopover, lawCard } from './law-card.svelte';

	let el = $state<HTMLElement>();
	let card = $state<ArticleCard | null>(null);
	let failed = $state(false);
	/** 読んだカード（同じ条をもう一度押したときは読み直さない） */
	const cache = new Map<string, ArticleCard>();

	const label = $derived(card?.label ?? (lawCard.href ? articleLabel(lawCard.href.split('/').pop() ?? '') : ''));
	const meta = $derived.by(() => {
		if (!card) return '';
		const parts = card.asOf ? [ja.lawCard.real, ja.lawCard.asOf(card.asOf)] : [ja.lawCard.readable];
		if (card.paragraphs > 1) parts.push(ja.lawCard.firstOnly(card.paragraphs));
		return ja.lawCard.meta(parts);
	});

	// リンクが押されたら開いて読む。読み終える前にほかのリンクが押されたら、前の結果は捨てる
	$effect(() => {
		const opened = lawCard.opened;
		const href = lawCard.href;
		if (!el || !href || !opened || !canPopover()) return;
		const cached = cache.get(href);
		card = cached ?? null;
		failed = false;
		if (!el.matches(':popover-open')) el.showPopover();
		place();
		el.focus();
		if (cached) return;
		fetch(`${href}/card`)
			.then((res) => (res.ok ? (res.json() as Promise<ArticleCard>) : Promise.reject(new Error(String(res.status)))))
			.then((loaded) => {
				cache.set(href, loaded);
				if (lawCard.opened === opened) card = loaded;
			})
			.catch(() => {
				if (lawCard.opened === opened) failed = true;
			});
	});

	/** PC：押したリンクのすぐ下に置く（画面の端からはみ出さない）。スマホは CSS で下に付ける */
	function place() {
		const anchor = lawCard.anchor;
		if (!el || !anchor) return;
		const r = anchor.getBoundingClientRect();
		const edge = 16;
		const right = document.documentElement.clientWidth - edge - el.offsetWidth;
		el.style.setProperty('--card-left', `${Math.max(edge, Math.min(r.left, right)) + window.scrollX}px`);
		el.style.setProperty('--card-top', `${r.bottom + window.scrollY + 8}px`);
	}

	function close() {
		if (canPopover() && el?.matches(':popover-open')) el.hidePopover();
	}

	/** 閉じたら、押したリンクに戻る（読み上げとキーボードの位置を失わない） */
	function onToggle(event: ToggleEvent) {
		if (event.newState !== 'closed') return;
		const anchor = lawCard.anchor;
		lawCard.href = null;
		if (anchor?.isConnected && (document.activeElement === document.body || el?.contains(document.activeElement))) anchor.focus();
	}

	// 「この条を開く」などでページを移ったら閉じる
	afterNavigate(() => close());
</script>

<div bind:this={el} id="law-card" class="card" popover="auto" role="dialog" aria-labelledby="law-card-title" tabindex="-1" ontoggle={onToggle}>
	<div class="head">
		<div>
			{#if card}<p class="law">{card.lawTitle}</p>{/if}
			<h2 id="law-card-title">{label}{#if card?.caption}<span class="caption">{card.caption}</span>{/if}</h2>
		</div>
		<button type="button" class="x" aria-label={ja.lawCard.close} onclick={close}>
			<svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20"><path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="2" /></svg>
		</button>
	</div>
	{#if card}
		<p class="text">{card.text}</p>
	{:else if failed}
		<p class="text" role="alert">{ja.lawCard.failed}</p>
	{:else}
		<p class="text loading" role="status">{ja.lawCard.loading}</p>
	{/if}
	<div class="foot">
		{#if meta}<p class="meta">{meta}</p>{/if}
		<div class="actions">
			<a class="open" href={lawCard.href ?? undefined}>{ja.lawCard.open}</a>
			<button type="button" class="close" onclick={close}>{ja.lawCard.close}</button>
		</div>
	</div>
</div>

<style>
	/* スマホ：下から出るシート（SpLawCard）。後ろは暗くする */
	.card {
		position: fixed;
		inset: auto 0 0 0;
		box-sizing: border-box;
		width: 100%;
		max-width: none;
		max-height: 80vh;
		margin: 0;
		padding: 1.25rem 1rem 1rem;
		overflow: auto;
		border: none;
		border-radius: var(--radius-l) var(--radius-l) 0 0;
		background: var(--color-bg);
		color: var(--color-text);
		font-size: var(--font-size-body);
		line-height: var(--line-height-body);
		text-align: left;
		white-space: normal;
	}

	/* popover のないブラウザでは出さない（:popover-open を知らないブラウザは、下の規則ごと読み飛ばす） */
	.card {
		display: none;
	}

	.card:popover-open {
		display: block;
	}

	.card:focus {
		outline: none;
	}

	.card::backdrop {
		background: color-mix(in srgb, var(--color-text) 40%, transparent);
	}

	.head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.law {
		margin: 0;
		color: var(--color-text-sub);
		font-size: var(--font-size-sub);
	}

	h2 {
		margin: 0;
		font-size: var(--font-size-heading);
	}

	.caption {
		margin-left: 0.5em;
		color: var(--color-text-sub);
		font-size: var(--font-size-body);
		font-weight: normal;
	}

	.x {
		display: inline-flex;
		flex: none;
		align-items: center;
		justify-content: center;
		width: var(--tap-min);
		height: var(--tap-min);
		margin: -0.5rem -0.5rem 0 0;
		padding: 0;
		border: none;
		background: none;
		color: var(--color-text);
		cursor: pointer;
	}

	.text {
		margin: 0.75rem 0;
		line-height: var(--line-height-law);
		white-space: pre-line;
		overflow-wrap: anywhere;
	}

	.loading {
		color: var(--color-text-sub);
	}

	.meta {
		margin: 0 0 0.75rem;
		color: var(--color-text-sub);
		font-size: var(--font-size-sub);
	}

	.actions {
		display: flex;
		gap: 0.75rem;
	}

	.open,
	.close {
		display: inline-flex;
		flex: 1;
		align-items: center;
		justify-content: center;
		box-sizing: border-box;
		min-height: var(--tap-primary);
		border-radius: var(--radius-m);
		font: inherit;
		font-weight: bold;
		text-decoration: none;
	}

	.open {
		background: var(--color-base);
		color: var(--color-bg);
	}

	.close {
		border: 1px solid var(--color-input-border);
		background: var(--color-bg);
		color: var(--color-text);
		font-weight: normal;
		cursor: pointer;
	}

	/* PC：押したリンクのすぐ下に出る小さな枠（PcLawCard）。後ろは暗くしない。閉じるのは × と枠の外 */
	@media (min-width: 64rem) {
		.card {
			position: absolute;
			inset: auto;
			top: var(--card-top, 0);
			left: var(--card-left, 0);
			width: 31.25rem;
			max-width: calc(100vw - 2rem);
			max-height: 60vh;
			padding: 1.25rem;
			border: 1px solid var(--color-divider);
			border-radius: var(--radius-l);
			box-shadow: 0 0.5rem 1.5rem color-mix(in srgb, var(--color-text) 15%, transparent);
		}

		.card::backdrop {
			background: transparent;
		}

		.text {
			font-size: var(--font-size-body);
		}

		.foot {
			display: flex;
			align-items: baseline;
			justify-content: space-between;
			gap: 1rem;
		}

		.meta {
			margin: 0;
		}

		.open {
			flex: none;
			min-height: auto;
			background: none;
			color: var(--color-link);
			font-size: var(--font-size-sub);
			text-decoration: underline;
		}

		.close {
			display: none;
		}
	}
</style>
