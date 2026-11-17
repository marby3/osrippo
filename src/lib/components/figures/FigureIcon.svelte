<script lang="ts" module>
	export type IconName = 'issue' | 'support' | 'solution' | 'draft' | 'invite' | 'check' | 'login' | 'game' | 'open' | 'person' | 'vote' | 'calendar' | 'amend' | 'repeal' | 'enact';
</script>

<script lang="ts">
	// 説明の図のアイコン（Issue #225）。線は文字の色（currentColor）で描き、色は置いた場所の CSS 変数から決まる
	let { name }: { name: IconName | string } = $props();
</script>

<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
	{#if name === 'issue'}
		<!-- 吹き出しと「!」 -->
		<path d="M4 4.5h16v11.5H10l-6 4.5z" />
		<path d="M12 7.5v4" />
		<circle class="dot" cx="12" cy="13.6" r="0.9" />
	{:else if name === 'support'}
		<!-- 気持ちが重なる（ハート） -->
		<path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20z" />
	{:else if name === 'solution'}
		<!-- 電球 -->
		<path d="M9 17.5h6M10 21h4" />
		<path d="M12 3a6 6 0 0 0-3.5 10.9v3.6h7v-3.6A6 6 0 0 0 12 3z" />
	{:else if name === 'draft'}
		<!-- 紙と線 -->
		<path d="M6 3h8.5L19 7.5V21H6z" />
		<path d="M14.5 3v4.5H19M9 11h7M9 14.5h7M9 18h4" />
	{:else if name === 'vote'}
		<!-- 投票箱 -->
		<path d="M3.5 12h17v8.5h-17z" />
		<path d="M8.5 12V4h7v8M10.5 8l1.2 1.2L14 6.8" />
	{:else if name === 'invite'}
		<!-- 招待券 -->
		<path d="M3 7h18v3a2 2 0 0 0 0 4v3H3v-3a2 2 0 0 0 0-4z" />
		<path d="M9 7v10" class="dash" />
	{:else if name === 'check'}
		<!-- チェックを入れた四角 -->
		<rect x="4" y="4" width="16" height="16" rx="2.5" />
		<path d="M8 12.2l2.8 2.8L16.2 9" />
	{:else if name === 'login'}
		<!-- 扉へ入る矢印 -->
		<path d="M13.5 4H19v16h-5.5" />
		<path d="M4 12h10.5M10.5 8l4 4-4 4" />
	{:else if name === 'game'}
		<!-- さいころ -->
		<rect x="4" y="4" width="16" height="16" rx="3" />
		<circle class="dot" cx="9" cy="9" r="1.3" />
		<circle class="dot" cx="15" cy="15" r="1.3" />
		<circle class="dot" cx="12" cy="12" r="1.3" />
	{:else if name === 'open'}
		<!-- 地球（だれでも読める） -->
		<circle cx="12" cy="12" r="8.5" />
		<path d="M3.5 12h17M12 3.5c2.6 2.4 3.8 5.2 3.8 8.5s-1.2 6.1-3.8 8.5c-2.6-2.4-3.8-5.2-3.8-8.5s1.2-6.1 3.8-8.5z" />
	{:else if name === 'calendar'}
		<!-- 暦 -->
		<rect x="3.5" y="5" width="17" height="15.5" rx="2" />
		<path d="M3.5 10h17M8 3v4M16 3v4" />
	{:else if name === 'amend'}
		<!-- 鉛筆（書きかえる） -->
		<path d="M4 20l1-4.5L15.5 5a2.1 2.1 0 0 1 3 3L8 18.5z" />
		<path d="M13.5 7l3 3" />
	{:else if name === 'repeal'}
		<!-- 紙にバツ（まるごと廃止） -->
		<path d="M6 3h12v18H6z" />
		<path d="M9 9l6 6M15 9l-6 6" />
	{:else if name === 'enact'}
		<!-- 紙に＋（新しく作る） -->
		<path d="M6 3h12v18H6z" />
		<path d="M12 8.5v7M8.5 12h7" />
	{:else if name === 'person'}
		<!-- 人ひとり -->
		<circle cx="12" cy="8" r="4" />
		<path d="M4.5 21a7.5 7.5 0 0 1 15 0" />
	{/if}
</svg>

<style>
	.icon {
		display: block;
		width: 2rem;
		height: 2rem;
		flex: none;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.8;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.dot {
		fill: currentColor;
		stroke: none;
	}

	.dash {
		stroke-dasharray: 1.5 2;
	}
</style>
