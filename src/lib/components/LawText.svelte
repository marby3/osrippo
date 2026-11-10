<script lang="ts">
	// 条文の文。法令用語の上に読み仮名を付ける（Issue #129）。読み仮名を出すかは表示の設定（html の data-ruby）で決まる。
	// segments を渡せば、それを描く（変更点は部分ごとに分けたものを渡す）。
	// 読み仮名は CSS で描き（base.css の rt[data-rt]）、文の文字には入れない。条文をコピーしたりページの中で探したりしたときに読み仮名が混ざらない
	import { rubySegments, type RubySegment } from '../domain/law/glossary';

	let { text = '', segments }: { text?: string; segments?: RubySegment[] } = $props();
	const list = $derived(segments ?? rubySegments(text));
</script>

{#each list as s}{#if s.rt !== undefined}<ruby>{s.text}<rt data-rt={s.rt}></rt></ruby>{:else}{s.text}{/if}{/each}
