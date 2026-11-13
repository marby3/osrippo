<script lang="ts">
	// 探す欄（案 SpIssues・PcIssues、Issue #120）。ホームと課題の一覧と法律の一覧（Issue #163）で同じ形にする。
	// 見えるボタンは出さず、キーボードの「検索」キーと Enter で送る。読み上げとキーボードのためにボタンは見えない形で残す
	import { ja } from '../copy/ja';

	let {
		id,
		label,
		action,
		value = '',
		hidden = {},
		placeholder = ja.search.placeholder,
		hint = null
	}: {
		id: string;
		label: string;
		action: string;
		value?: string;
		/** 一緒に送る値（いまの並びや絞り込み） */
		hidden?: Record<string, string>;
		placeholder?: string;
		/** 欄の下の説明（法律の一覧の「条文の言葉は3文字以上で探せます」） */
		hint?: string | null;
	} = $props();
</script>

<form method="get" {action} class="search">
	{#each Object.entries(hidden) as [name, v] (name)}<input type="hidden" {name} value={v} />{/each}
	<label for={id}>{label}</label>
	<input {id} name="q" type="search" {value} maxlength="60" {placeholder} enterkeyhint="search" aria-describedby={hint ? `${id}-hint` : undefined} />
	{#if hint}<p class="hint" id="{id}-hint">{hint}</p>{/if}
	<button class="visually-hidden">{ja.search.submit}</button>
</form>

<style>
	.search {
		display: grid;
		gap: 0.25rem;
	}

	label {
		font-size: var(--font-size-sub);
		font-weight: bold;
	}

	input {
		min-height: var(--tap-secondary);
		padding: 0 0.75rem;
		border: 1px solid var(--color-input-border);
		border-radius: var(--radius-m);
		font: inherit;
	}

	.hint {
		margin: 0;
		color: var(--color-text-sub);
		font-size: var(--font-size-min);
	}

	input::placeholder {
		color: var(--color-text-sub);
	}

	/* キーボードで移ったときだけボタンを見せる（フォーカスが見えるように） */
	button:focus-visible {
		position: static;
		width: auto;
		height: auto;
		min-height: var(--tap-min);
		margin: 0.25rem 0 0;
		padding: 0 1rem;
		border: 1px solid var(--color-base);
		border-radius: var(--radius-m);
		clip-path: none;
		background: var(--color-base);
		color: var(--color-bg);
		font: inherit;
		font-weight: bold;
	}
</style>
