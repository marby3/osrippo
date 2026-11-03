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

/** ミリ秒 → 日本時間の「11月4日 9時05分」 */
export const jaDateTime = (ms: number) => {
	const d = new Date(ms + 9 * 60 * 60 * 1000);
	return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日 ${d.getUTCHours()}時${String(d.getUTCMinutes()).padStart(2, '0')}分`;
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
		beforeBaseline: '2017年4月より前の改正は準備中',
		compareLink: '2つの版を比べる',
		toc: '目次',
		openToc: '目次から探す',
		band: (titles: string[]) => titles.join('／'),
		openRecord: '変わった記録を見る',
		recordTitle: (label: string) => `${label}が変わった記録`,
		enforcedOn: (date: string) => `${jaDate(date)} 施行`,
		then: (label: string) => `（当時は${label}）`,
		recordBeforeBaseline: '2017年4月より前',
		recordPreparing: '条文ごとの記録は準備中',
		recordFailed: '変わった記録を読み込めませんでした。もう一度押してください。'
	},
	login: {
		pageTitle: 'ログイン｜オープンソース立法府',
		heading: 'ログイン',
		lead: '課題を書いたり「わかる」を付けたりするには、ログインしてください。読むだけならログインはいりません。',
		google: 'Googleでログイン',
		line: 'LINEでログイン',
		failed: 'ログインできませんでした。もう一度お試しください。'
	},
	/** 書き込みの前の確かめ（設計書 docs/spec/25.md） */
	guard: {
		outsideJapan: '日本国内からのみ参加できます。見ることは国外からもできます。',
		turnstileFailed: '確認できませんでした。もう一度お試しください。',
		turnstileUnavailable: '確認の仕組みを読み込めませんでした。ページを読み直してください。',
		banned: (until: number) => `制限を何度も超えたため、${jaDateTime(until)}まで、課題の投稿と「わかる」ができません。`,
		refusals: {
			'post-account': '課題は24時間に5件まで書けます。しばらくしてからお試しください。',
			'post-new': (retryAt: number) =>
				`登録したばかりのあいだは、課題は24時間に1件まで書けます。${jaDateTime(retryAt)}から次の課題を書けます。`,
			'post-ip': 'この回線から書ける課題の数を超えました。しばらくしてからお試しください。',
			'support-day': '「わかる」は24時間に50回まで押せます。しばらくしてからお試しください。',
			'support-burst': '短いあいだに「わかる」を何度も押しました。しばらくしてからお試しください。',
			'support-ip': 'この回線からは、この課題にこれ以上「わかる」を付けられません。'
		}
	},
	issue: {
		listPageTitle: '課題｜オープンソース立法府',
		heading: '課題',
		topLink: '課題を見る',
		write: '課題を書く',
		filterLabel: '表示する課題',
		filterAll: 'すべて',
		filterTopic: '今回のお題',
		sortLabel: '並び',
		sorts: { support: '「わかる」の多い順', new: '新しい順', rising: '最近「わかる」が増えている順' },
		columnTitle: '課題',
		columnSupports: 'わかる',
		columnTopic: 'お題',
		supports: 'わかる',
		topicMark: (name: string) => `お題：${name}`,
		empty: 'まだ課題がありません',
		emptyTopic: '今回のお題の課題はまだありません',
		prevPage: '前の50件',
		nextPage: '次の50件',
		pageTitle: (title: string) => `${title}｜オープンソース立法府`,
		affected: '困っている人',
		example: '具体的には',
		support: 'わかる',
		supportHint: '同じことで困っていたら押してください',
		writePageTitle: '課題を書く｜オープンソース立法府',
		steps: ['タイトル', 'くわしく', '確認'],
		titleLabel: '何に困っていますか？',
		affectedLabel: '困っている人',
		exampleLabel: '具体的には',
		topicLegend: (name: string) => `今回のお題（${name}）に関係ありますか`,
		topicYes: (name: string) => `関係ある（${name}）`,
		topicNo: 'ほかの話題',
		next: '次へ',
		back: '戻る',
		cancel: 'やめる',
		confirmLead: 'この内容で投稿します。',
		submit: '投稿する',
		errors: {
			required: '入力してください',
			tooLong: (max: number) => `${max}字以内で書いてください`,
			newline: '改行は使えません',
			control: '使えない文字が入っています',
			invalid: 'どちらかを選んでください'
		}
	},
	watashi: {
		pageTitle: 'わたしの記録｜オープンソース立法府',
		heading: 'わたしの記録',
		name: '表示名',
		logout: 'ログアウト'
	},
	compare: {
		pageTitle: (title: string) => `${title}の2つの版を比べる｜オープンソース立法府`,
		heading: '2つの版を比べる',
		before: '前の版',
		after: '後の版',
		submit: '比べる',
		option: (date: string, title: string, scheduled: boolean) =>
			`${jaDate(date)}施行${scheduled ? '（施行予定）' : ''}　${title}`,
		beforeSide: '改正前',
		afterSide: '改正後',
		added: '新しく入った条',
		removed: 'なくなった条',
		renumbered: (label: string) => `（改正前は${label}）`,
		none: '変わった条はありません'
	}
};
