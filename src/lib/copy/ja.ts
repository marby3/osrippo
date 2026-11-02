// 画面の文言はすべてここに置く

/** "2023-06-01" → "2023年6月1日" */
export const jaDate = (iso: string) => {
	const [y, m, d] = iso.split('-').map(Number);
	return `${y}年${m}月${d}日`;
};

const jaMonth = (iso: string) => {
	const [y, m] = iso.split('-').map(Number);
	return `${y}年${m}月`;
};

export const ja = {
	siteName: 'オープンソース立法府',
	unofficial: '国会・政府とは無関係の非公式サービスです',
	law: {
		pageTitle: (title: string) => `${title}｜オープンソース立法府`,
		meta: (lawNum: string, asOf: string) => `${lawNum} ・ ${jaDate(asOf)}施行の版`,
		// 1年未満は年数を出さない（2026-11-02 決定）
		amended: (date: string, years: number) =>
			years < 1 ? `${jaMonth(date)}に改正` : `${jaMonth(date)}に改正・${years}年変わっていない`,
		unchangedSinceBaseline: '2017年4月より前から変更なし',
		history: '改正履歴',
		enforced: '施行された改正',
		scheduled: '施行予定',
		beforeBaseline: '2017年4月より前の改正は準備中'
	}
};
