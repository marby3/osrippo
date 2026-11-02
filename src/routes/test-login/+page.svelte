<script lang="ts">
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<!-- テスト専用のページなので、文言は ja.ts に置かない -->
<main>
	<p>テスト用のログイン：{data.name}</p>
	<p><a href={data.next}>{data.next}</a></p>
</main>
