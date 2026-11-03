<script lang="ts">
	import { ja } from '#lib/copy/ja.ts';
</script>

<h1>{ja.siteName}</h1>
<p><a href="/kadai">{ja.issue.topLink}</a></p>
<!-- 全文検索の入口（設計書 docs/spec/38.md 決めたこと7） -->
<form method="get" action="/kensaku">
	<label for="top-search">{ja.search.entry}</label>
	<input id="top-search" name="q" type="search" maxlength="60" />
	<button>{ja.search.submit}</button>
</form>
