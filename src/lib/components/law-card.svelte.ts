// 条のカード（Issue #165）を開く。本文の中のリンク（LawRefText）が押されたら、全体の枠に1つだけ置いたカード（LawCard）を開く。
// スクリプトが動かないときや、新しいタブで開く押し方のときは、ふつうのリンクとして条だけのページへ移る

export const lawCard = $state<{ href: string | null; anchor: HTMLElement | null; opened: number }>({ href: null, anchor: null, opened: 0 });

export function openLawCard(event: MouseEvent, href: string) {
	if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
	// SvelteKit のリンクの移動より先に止める（リンクの要素で受けるので、body で受ける SvelteKit より先）
	event.preventDefault();
	lawCard.anchor = event.currentTarget as HTMLElement;
	lawCard.href = href;
	lawCard.opened++;
}
