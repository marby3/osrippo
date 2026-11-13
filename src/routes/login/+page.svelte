<script lang="ts">
	import Turnstile from '#lib/components/Turnstile.svelte';
	import googleLogo from '#lib/assets/google.svg';
	import lineLogo from '#lib/assets/line.svg';
	import { ja } from '#lib/copy/ja.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	let token = $state('');
	/** 招待コードの欄の形が違ったとき（理由は欄の下に出す） */
	const inviteError = $derived(form && 'invite' in form ? form.message : null);
	/** はじめての方がお約束に同意していなかったとき（理由は同意の欄の下に出す。Issue #200） */
	const agreeError = $derived(form && 'agree' in form ? form.message : null);
	const failedMessage = $derived(
		data.failed === 'invite' ? ja.login.inviteRefused : data.failed === 'agreement' ? ja.login.agreeRefused : data.failed ? ja.login.failed : null
	);
</script>

<svelte:head>
	<title>{ja.login.pageTitle}</title>
</svelte:head>

<main>
	<h1>{ja.login.heading}</h1>
	<p>{ja.login.lead}</p>
	{#if failedMessage}<p role="alert">{failedMessage}</p>{/if}
	{#if form?.message && !inviteError && !agreeError}<p role="alert">{form.message}</p>{/if}
	<p>{ja.login.newcomer}</p>
	<!-- 並びは上から 説明文 → はじめての方への説明 → ボタン → 確認の枠（Issue #159）。見た目と読み上げの順をそろえる -->
	<form method="post">
		<input type="hidden" name="next" value={data.next} />
		<!-- 招待コード（Issue #199）。すでにアカウントのある人は空のままでよい -->
		<div class="invite">
			<label for="invite">{ja.login.inviteLabel}</label>
			<p id="invite-help" class="help">{ja.login.inviteHelp}</p>
			<input
				id="invite"
				name="invite"
				autocomplete="off"
				autocapitalize="characters"
				spellcheck="false"
				aria-describedby={inviteError ? 'invite-help invite-error' : 'invite-help'}
				aria-invalid={inviteError ? 'true' : undefined}
			/>
			{#if inviteError}<p id="invite-error" role="alert">{inviteError}</p>{/if}
		</div>
		<!-- β版のお約束への同意（Issue #200）。招待コードの欄の下。新規登録のときだけ要る -->
		<div class="agree">
			<label class="check">
				<input
					type="checkbox"
					name="agree"
					value={data.agreementVersion}
					aria-describedby={agreeError ? 'agree-help agree-error' : 'agree-help'}
					aria-invalid={agreeError ? 'true' : undefined}
				/>
				<span>{ja.login.agreeLabel}</span>
			</label>
			<p id="agree-help" class="help"><a href="/yakusoku">{ja.login.agreeHelpLink}</a>{ja.login.agreeHelpAfter}</p>
			{#if agreeError}<p id="agree-error" role="alert">{agreeError}</p>{/if}
		</div>
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

	.invite {
		display: grid;
		gap: 0.25rem;
	}

	.invite label {
		font-weight: bold;
	}

	.help {
		margin: 0;
		font-size: var(--font-size-sub);
		color: var(--color-text-sub);
	}

	.invite input {
		min-height: var(--tap-min);
		padding: 0.5rem 0.75rem;
		border: 1px solid var(--color-input-border);
		border-radius: var(--radius-m);
		font: inherit;
	}

	.invite [role='alert'],
	.agree [role='alert'] {
		margin: 0;
		color: var(--color-caution);
	}

	.agree {
		display: grid;
		gap: 0.25rem;
	}

	/* チェックの欄は、文字ごと押せる大きさにする */
	.check {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-height: var(--tap-min);
		font-weight: bold;
	}

	.check input {
		width: 1.25em;
		height: 1.25em;
		flex: none;
		margin: 0;
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
