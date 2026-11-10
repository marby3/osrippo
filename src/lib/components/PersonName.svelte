<!-- 人の名前（設計書 docs/spec/157.md の 5）。有効な認証があれば表示する名前とバッジ、なければ表示名。バッジは文字で区別する（色だけにしない） -->
<script lang="ts">
	import { ja } from '#lib/copy/ja.ts';
	import type { Person } from '#lib/domain/verification.ts';

	let { person }: { person: Person } = $props();
</script>

{#if person.verified}
	<span class="person"
		>{person.verified.name}<span class="badge"
			>{#if person.verified.kind === 'legislator'}<svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true"
					><path d="M12 2 4 5v6c0 5.2 3.4 9.4 8 11 4.6-1.6 8-5.8 8-11V5z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" /><path
						d="m8.5 12 2.5 2.5 4.5-5"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
					/></svg
				>{ja.verification.badges.legislator}{:else}{ja.verification.badges.expert(person.verified.field)}{/if}</span
		></span
	>
{:else}{person.name}{/if}

<style>
	.person {
		display: inline-flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.25em 0.5em;
	}

	.badge {
		display: inline-flex;
		align-items: center;
		gap: 0.25em;
		padding: 0 0.5em;
		border: 1px solid currentColor;
		border-radius: var(--radius-pill);
		font-size: var(--font-size-sub);
		font-weight: bold;
		color: var(--color-base);
		background: var(--color-surface);
	}
</style>
