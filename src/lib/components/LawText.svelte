<script lang="ts">
	// 条文の文。法令用語の上に読み仮名を付け（Issue #129）、説明のある言葉は押すとその場に説明を出す（Issue #143）。
	// 読み仮名を出すかは表示の設定（html の data-ruby）で決まる。説明は設定にかかわらず出す。
	// segments を渡せば、それを描く（変更点は部分ごとに分けたものを渡す）。
	// 読み仮名は CSS で描き（base.css の rt[data-rt]）、文の文字には入れない。条文をコピーしたりページの中で探したりしたときに読み仮名が混ざらない。
	// 説明はブラウザの popover で開く（スクリプトが動かなくても開け、Esc と枠の外で閉じ、ほかを開くと前が閉じる）。
	// 枠を言葉のすぐ下に置くのと、開いた・閉じたを aria-expanded で伝えるのはスクリプトでする
	import { ja } from '../copy/ja';
	import { glossSegments, type GlossSegment, type RubySegment } from '../domain/law/glossary';

	let { text = '', segments }: { text?: string; segments?: GlossSegment[] } = $props();
	const list = $derived(segments ?? glossSegments(text));
	const uid = $props.id();
	const reading = (parts: RubySegment[]) => (parts.some((p) => p.rt !== undefined) ? parts.map((p) => p.rt ?? p.text).join('') : null);

	/** 開いたら言葉のすぐ下に置く（画面の端からはみ出さない）。押した言葉に開いた・閉じたを付ける */
	function place(note: HTMLElement) {
		const onToggle = (e: Event) => {
			const open = (e as ToggleEvent).newState === 'open';
			const button = note.previousElementSibling as HTMLElement | null;
			button?.setAttribute('aria-expanded', String(open));
			if (!open || !button) return;
			const r = button.getBoundingClientRect();
			const edge = 16;
			const right = document.documentElement.clientWidth - edge - note.offsetWidth;
			note.style.left = `${Math.max(edge, Math.min(r.left, right)) + window.scrollX}px`;
			note.style.top = `${r.bottom + window.scrollY + 4}px`;
		};
		note.addEventListener('toggle', onToggle);
		return () => note.removeEventListener('toggle', onToggle);
	}
</script>

{#snippet rubies(parts: RubySegment[])}{#each parts as p}{#if p.rt !== undefined}<ruby>{p.text}<rt data-rt={p.rt}></rt></ruby>{:else}{p.text}{/if}{/each}{/snippet}

<!-- 文の中に置くので、要素のあいだに空白や改行を入れない（white-space: pre-line の文がある） -->
{#each list as s, i}{#if 'text' in s}{s.text}{:else if s.note === null}{@render rubies(s.parts)}{:else}<button type="button" class="term" popovertarget="{uid}-{i}" aria-expanded="false">{@render rubies(s.parts)}</button><span id="{uid}-{i}" class="note" popover {@attach place}><span class="word">{s.word}{#if reading(s.parts)}（{reading(s.parts)}）{/if}</span><span>{s.note}</span><span class="by">{ja.glossary.disclaimer}</span></span>{/if}{/each}

<style>
	/* 説明のある言葉：点線の下線。消した・足した部分の中では、その取り消し線と下線もそのまま付ける（ボタンには親の線が届かないので受け継ぐ） */
	.term {
		margin: 0;
		padding: 0;
		border: 0;
		border-bottom: 1px dotted currentColor;
		background: none;
		color: inherit;
		font: inherit;
		line-height: inherit;
		text-decoration: inherit;
		cursor: pointer;
	}

	.note {
		position: absolute;
		inset: auto;
		box-sizing: border-box;
		width: max-content;
		max-width: min(22rem, calc(100vw - 2rem));
		margin: 0;
		padding: 0.75rem;
		border: 1px solid var(--color-divider);
		border-radius: var(--radius-m);
		background: var(--color-bg);
		color: var(--color-text);
		font-size: var(--font-size-sub);
		font-weight: normal;
		line-height: var(--line-height-body);
		text-align: left;
		text-decoration: none;
		white-space: normal;
	}

	.note > span {
		display: block;
	}

	.word {
		font-weight: bold;
	}

	.by {
		margin-top: 0.5rem;
		color: var(--color-text-sub);
		font-size: var(--font-size-min);
	}
</style>
