<script lang="ts">
	import Turnstile from '#lib/components/Turnstile.svelte';
	import googleLogo from '#lib/assets/google.svg';
	import lineLogo from '#lib/assets/line.svg';
	import { ja } from '#lib/copy/ja.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	let token = $state('');
</script>

<svelte:head>
	<title>{ja.login.pageTitle}</title>
</svelte:head>

<main>
	<h1>{ja.login.heading}</h1>
	<p>{ja.login.lead}</p>
	{#if data.failed}<p role="alert">{ja.login.failed}</p>{/if}
	{#if form?.message}<p role="alert">{form.message}</p>{/if}
	<p>{ja.login.newcomer}</p>
	<!-- 並びは上から 説明文 → はじめての方への説明 → ボタン → 確認の枠（Issue #159）。見た目と読み上げの順をそろえる -->
	<form method="post">
		<input type="hidden" name="next" value={data.next} />
		<button formaction="?/google" disabled={!token}><img class="logo" src={googleLogo} alt="" aria-hidden="true" /><span>{ja.login.google}</span></button>
		<button formaction="?/line" disabled={!token}><img class="logo" src={lineLogo} alt="" aria-hidden="true" /><span>{ja.login.line}</span></button>
		<Turnstile siteKey={data.siteKey} size="flexible" bind:token />
	</form>
</main>

<style>
	main {
		max-width: 28rem;
		margin: 0 auto;
		padding: 1rem;
	}

	h1 {
		font-size: var(--font-size-page-title);
	}

	form {
		display: grid;
		gap: 0.75rem;
	}

	button:disabled {
		opacity: 0.5;
	}

	button {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.75rem;
		min-height: var(--tap-primary);
		border: 1px solid var(--color-input-border);
		border-radius: var(--radius-l);
		background: var(--color-bg);
		color: var(--color-text);
		font: inherit;
		font-weight: bold;
	}

	/* ロゴは文字の大きさに合わせる（表示の設定で文字を大きくしたときも） */
	.logo {
		width: 1.25em;
		height: 1.25em;
		flex: none;
	}
</style>
