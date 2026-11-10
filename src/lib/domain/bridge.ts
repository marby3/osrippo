// 立場を超えた支持のルール（Issue #149、設計書 docs/spec/149.md の 2）。DB にも画面にも触れない

/**
 * 議員ダッシュボードに出す割合：スコア（0〜1）を5%刻みに丸めた 0〜100 の整数。割合を使えない課題は null。
 * 1人の「わかる」で値が動いて、その人のグループを推定されにくくするため丸める
 */
export function roundRatio(score: number | null): number | null {
	return score === null ? null : Math.round(score * 20) * 5;
}
