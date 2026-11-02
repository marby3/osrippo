<script lang="ts">
	let { data } = $props();
</script>

<svelte:head><title>法令ビューア（Spike）</title></svelte:head>

<main>
	<h1>法令ビューア（フェーズ0 Spike）</h1>
	<ul>
		{#each data.laws as l (l.law_id)}
			<li><a href="/laws/{l.law_id}">{l.title}</a>（{l.n}版、最新 {l.latest}）</li>
		{/each}
	</ul>
	<form method="get">
		<label>条文を検索 <input name="q" value={data.q} /></label>
		<button>検索</button>
	</form>
	{#if data.q}
		<p>{data.hits.length}件（{data.ms}ms）</p>
		<ol>
			{#each data.hits as h, i (i)}
				<li><b>{h.law_title} {h.article_title}</b><br />{h.snippet.slice(0, 160)}</li>
			{/each}
		</ol>
	{/if}
</main>

<style>
	main { max-width: 46rem; margin: 0 auto; padding: 1rem; font-family: system-ui, sans-serif; line-height: 1.8; }
</style>
