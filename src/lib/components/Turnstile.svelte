<script module lang="ts">
	// Turnstile（設計書 docs/spec/25.md 決めたこと8）。api.js は1回だけ読む
	type Api = {
		render(el: HTMLElement, options: Record<string, unknown>): string;
		reset(id: string): void;
		remove(id: string): void;
	};
	const api = () => (window as unknown as { turnstile?: Api }).turnstile;

	let loading: Promise<void> | undefined;
	function load(): Promise<void> {
		if (api()) return Promise.resolve();
		loading ??= new Promise<void>((resolve, reject) => {
			const script = document.createElement('script');
			script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
			script.async = true;
			script.onload = () => resolve();
			script.onerror = () => {
				loading = undefined;
				reject(new Error('Turnstile を読み込めません'));
			};
			document.head.appendChild(script);
		});
		return loading;
	}
</script>

<script lang="ts">
	import { onMount } from 'svelte';
	import { ja } from '../copy/ja';

	/**
	 * token は確認が済むと入り、期限切れや作り直しで空に戻る。
	 * size は枠の大きさ（Cloudflare の指定）。'flexible' は置いた場所の幅いっぱいに広がる（Issue #159）。省くと Cloudflare の標準
	 */
	let { siteKey, token = $bindable(''), size }: { siteKey: string; token?: string; size?: 'normal' | 'flexible' | 'compact' } = $props();
	let container: HTMLDivElement;
	let widgetId: string | undefined;
	let loadFailed = $state(false);

	onMount(() => {
		let destroyed = false;
		load()
			.then(() => {
				if (destroyed) return;
				widgetId = api()?.render(container, {
					sitekey: siteKey,
					...(size ? { size } : {}),
					callback: (t: string) => (token = t),
					'expired-callback': () => (token = ''),
					'error-callback': () => (token = '')
				});
			})
			.catch(() => {
				token = '';
				loadFailed = true;
			});
		return () => {
			destroyed = true;
			if (widgetId) api()?.remove(widgetId);
		};
	});

	/** トークンは1回しか使えないので、サーバーで使ったあとは作り直す */
	export function reset() {
		token = '';
		if (widgetId) api()?.reset(widgetId);
	}
</script>

<div bind:this={container} data-turnstile></div>
{#if loadFailed}<p role="alert">{ja.guard.turnstileUnavailable}</p>{/if}
