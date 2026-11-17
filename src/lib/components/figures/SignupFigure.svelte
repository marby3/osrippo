<script lang="ts">
	// ログインのはじめての方への説明の図（Issue #225）：登録の3つの手順
	import { ja } from '#lib/copy/ja.ts';
	import Figure from './Figure.svelte';
	import NodeRow from './NodeRow.svelte';

	const t = ja.figures.signup;
</script>

<Figure label={t.label}>
	<NodeRow nodes={t.steps} numbered />
</Figure>
