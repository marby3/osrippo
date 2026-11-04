// 画面の文言はすべてここに置く
import type { Session } from '../domain/session';

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

/** ミリ秒 → 日本時間の「2026年11月4日 9時05分」 */
export const jaDateTimeFull = (ms: number) => {
	const d = new Date(ms + 9 * 60 * 60 * 1000);
	return `${d.getUTCFullYear()}年${jaDateTime(ms)}`;
};

/** ミリ秒 → 日本時間の「5月22日（水）」 */
const jaDay = (ms: number) => {
	const d = new Date(ms + 9 * 60 * 60 * 1000);
	return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日（${'日月火水木金土'[d.getUTCDay()]}）`;
};

/** ミリ秒 → 日本時間の「9時08分」 */
const jaTime = (ms: number) => {
	const d = new Date(ms + 9 * 60 * 60 * 1000);
	return `${d.getUTCHours()}時${String(d.getUTCMinutes()).padStart(2, '0')}分`;
};

/** カレンダーの月の会期は日付、開発用の分の会期は時刻 */
const sessionPoint = (s: Session, ms: number, withDay: boolean) =>
	s.month === null ? jaTime(ms) : withDay ? jaDay(ms) : jaDay(ms).replace(/（.）$/, '');

export const ja = {
	siteName: 'オープンソース立法府',
	unofficial: '国会・政府とは無関係の非公式サービスです',
	law: {
		pageTitle: (title: string) => `${title}｜オープンソース立法府`,
		meta: (lawNum: string, asOf: string) => `${lawNum} ・ ${jaDate(asOf)}施行の版`,
		// 1年未満は年数を出さない（2026-11-02 決定）
		amended: (date: string, years: number) =>
			years < 1 ? `${jaMonth(date)}に改正` : `${jaMonth(date)}に改正・${years}年変わっていない`,
		// 2017年4月より後に制定された法令で、制定のあと変わっていない条（Issue #18。1年未満は年数を出さない）
		enacted: (date: string, years: number) =>
			years < 1 ? `${jaMonth(date)}に制定` : `${jaMonth(date)}に制定・${years}年変わっていない`,
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
		enactedOn: (date: string) => `${jaDate(date)} 制定`,
		enactment: '制定',
		then: (label: string) => `（当時は${label}）`,
		recordBeforeBaseline: '2017年4月より前',
		recordPreparing: '条文ごとの記録は準備中',
		recordFailed: '変わった記録を読み込めませんでした。もう一度押してください。'
	},
	/** 会期（Issue #44。画面の案 SpHome・PcHome） */
	session: {
		name: (s: Session) => (s.month === null ? `${jaTime(s.startsAt)}からの会期` : `${s.month}月の会期`),
		stages: { proposal: '発議', deliberation: '質疑と修正', vote: '採決' },
		now: 'いまは',
		week: (week: number) => `（${week}週目）`,
		progress: '会期の進み具合',
		/** スマホの棒の読み上げ */
		bar: (week: number, filled: boolean) => `${week}週目${filled ? '（済み）' : ''}`,
		/** スマホの次の段の始まり：[前, 日付, 後] */
		next: (s: Session): [string, string, string] =>
			s.stage === 'proposal'
				? ['質疑は', sessionPoint(s, s.deliberationAt, true), 'から']
				: s.stage === 'deliberation'
					? ['採決は', sessionPoint(s, s.voteAt, true), 'から']
					: ['次の会期は', sessionPoint(s, s.endsAt, true), 'から'],
		/** PC の 2:1:1 の区切り */
		segments: (s: Session) => ['1〜2週 発議', '3週 質疑・修正', `4週 採決（${sessionPoint(s, s.voteAt, false)}から）`]
	},
	/** 法案の下書きの誤り（設計書 docs/spec/45.md 決めたこと9。画面は #46・#47） */
	bill: {
		errors: {
			required: 'ここを書いてください。',
			tooLong: '長すぎます。字数を減らしてください。',
			newline: '改行は入れられません。',
			control: '使えない文字が入っています。',
			invalid: '種類を選んでください。',
			summaryLines: '3行要約は3行までにしてください。',
			lawTitleSuffix: '法令名は「法」か「法律」で終わるようにしてください。',
			lawCount: '対象の法令は1〜5本にしてください。',
			lawShape: '対象の法令の選び方が、法案の種類に合っていません。',
			lawNotInCommittee: 'この委員会で扱う法令ではありません。',
			duplicateLaw: '同じ法令が2回選ばれています。',
			changeCount: '変える条は、法案全体で50条までにしてください。',
			solutionCount: '元になった解決策を1〜5つ選んでください。',
			duplicateSolution: '同じ解決策が2回選ばれています。',
			solutionHidden: '引用できない解決策が入っています。'
		},
		/** 変更後の条文の欄（何行目かを添える） */
		bodyErrors: {
			required: '条文を書いてください。',
			tooLong: '条文が長すぎます（1条あたり10000字まで）。',
			control: '使えない文字が入っています。',
			paragraphOrder: '項の番号が順になっていません（2、3、4…と続けてください）。',
			itemOrder: '号の番号は、前の号より後ろの番号にしてください。',
			empty: '項や号の本文が空です。'
		},
		bodyErrorAt: (line: number, message: string) => `${line}行目：${message}`,
		changeErrors: {
			unknownProvision: 'この法令にない条です。',
			numMismatch: '条の番号が合っていません。',
			unchanged: 'いまの条文から変わっていません。',
			bodyMissing: '条文を書いてください。',
			captionTooLong: '見出しが長すぎます（100字まで）。',
			captionInvalid: '見出しに改行や使えない文字が入っています。',
			deleteDeleted: 'この条はもう削除されています。',
			deleteHasBody: '削除する条には条文を書けません。',
			addNotBranch: '新しい条は「第3条の2」のように、前の条の枝番にしてください。',
			addExists: 'その番号の条はもうあります。',
			addNoParent: '枝番の元になる条がありません。',
			duplicate: '同じ条に2つの変更があります。',
			enactNotAdd: '新しい法律では、条を書き足すことだけができます。',
			enactNumOrder: '新しい法律の条は、第1条から順に番号を付けてください。',
			enactPurpose: '新しい法律には、見出しが「（目的）」の第1条が要ります。',
			amendEmpty: '変える条を1つ以上選んでください。',
			repealHasChanges: '廃止する法令には、変える条を書けません。'
		}
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
		banned: (until: number) =>
			`制限を何度も超えたため、${jaDateTime(until)}まで、課題や解決策の投稿、「わかる」「考えが変わった」、通報ができません。`,
		refusals: {
			'post-account': '課題は24時間に5件まで書けます。しばらくしてからお試しください。',
			'post-new': (retryAt: number) =>
				`登録したばかりのあいだは、課題は24時間に1件まで書けます。${jaDateTime(retryAt)}から次の課題を書けます。`,
			'post-ip': 'この回線から書ける課題の数を超えました。しばらくしてからお試しください。',
			// 課題の「わかる」と解決策の「わかる」「考えが変わった」は合わせて数える（設計書 docs/spec/34.md 決めたこと5）
			'support-day': '「わかる」と「考えが変わった」は、合わせて24時間に50回まで押せます。しばらくしてからお試しください。',
			'support-burst': '短いあいだに「わかる」や「考えが変わった」を何度も押しました。しばらくしてからお試しください。',
			'support-ip': 'この回線からは、この課題にこれ以上「わかる」を付けられません。',
			'report-day': '通報は24時間に10件までできます。しばらくしてからお試しください。',
			'solution-account': '解決策は24時間に10件まで書けます。しばらくしてからお試しください。',
			'solution-new': (retryAt: number) =>
				`登録したばかりのあいだは、解決策は24時間に3件まで書けます。${jaDateTime(retryAt)}から次の解決策を書けます。`,
			'solution-ip': 'この回線から書ける解決策の数を超えました。しばらくしてからお試しください。',
			'reaction-ip': 'この回線からは、この解決策にこれ以上押せません。'
		}
	},
	/** 通報（設計書 docs/spec/28.md） */
	report: {
		open: 'この課題を通報する',
		legend: '通報の理由（選ばなくてもかまいません）',
		reasons: {
			attack: '人への攻撃・差別',
			spam: '宣伝・荒らし',
			duplicate: '同じ課題がほかにある',
			other: 'その他',
			none: '理由なし'
		},
		noteLabel: 'その他の説明（200字まで）',
		criteria: '登録から24時間たった別々の3人から通報があると、運営が確認するまで一時的に見えなくなります。',
		criteriaLink: '非表示にする基準と運営の記録',
		submit: '通報する',
		done: '通報を受け付けました',
		already: 'この課題は通報済みです',
		hiddenIssue: '非表示の課題には操作できません'
	},
	/** 解決策（設計書 docs/spec/34.md） */
	solution: {
		heading: '解決策',
		count: (n: number) => `${n}件`,
		write: '解決策を書く',
		all: (n: number) => `解決策をすべて見る（${n}件）`,
		support: (n: number) => `わかる ${n}`,
		changed: (n: number) => `考えが変わった ${n}`,
		/** 課題そのものの「わかる」と区別する、読み上げだけの前置き */
		srPrefix: 'この解決策に',
		empty: 'まだ解決策はありません',
		fromSimilar: '「わかる」を付けました。考えがあれば、解決策として書いてください',
		listPageTitle: (title: string) => `${title}の解決策｜オープンソース立法府`,
		listHeading: '解決策の一覧',
		writePageTitle: '解決策を書く｜オープンソース立法府',
		label: '解決策',
		submit: '投稿する',
		cannotWrite: 'この課題には解決策を書けません',
		hiddenOp: '非表示の解決策には操作できません',
		reportOpen: 'この解決策を通報する',
		reportDone: '通報を受け付けました',
		reportAlready: 'この解決策は通報済みです',
		hiddenHeading: '非表示の解決策',
		hiddenAuto: 'この解決策は通報により非表示になっています',
		hiddenStaff: (reason: string | null) =>
			reason === null
				? 'この解決策は運営の確認により非表示になっています'
				: `この解決策は運営の確認により非表示になっています（理由：${reason}）`,
		showHidden: '非表示の解決策を見る',
		staffLink: 'この解決策に運営として対応する',
		ownSolution: '自分の解決策には押せません',
		prevPage: '前の50件',
		nextPage: '次の50件'
	},
	/** 全文検索（設計書 docs/spec/38.md） */
	search: {
		pageTitle: '探す｜オープンソース立法府',
		heading: '探す',
		label: '探す言葉',
		submit: '探す',
		entry: '法令や課題を探す',
		issueLabel: '課題を探す',
		errors: {
			short: '2文字以上で入力してください',
			long: '60字まで、言葉は5つまでで入力してください',
			control: '使えない文字が入っています'
		},
		sections: { laws: '法令', jobun: '条文', kadai: '課題', kaiketsu: '解決策' },
		count: (n: number) => `${n}件`,
		none: '見つかりませんでした',
		more: (n: number) => `もっと見る（${n}件）`,
		capped: '1000件を超えました。言葉を足してしぼりこんでください',
		supports: (n: number) => `わかる ${n}`,
		back: '探した結果のすべてへ',
		prevPage: '前の50件',
		nextPage: '次の50件'
	},
	/** 似た課題（設計書 docs/spec/30.md） */
	similar: {
		heading: '似た課題があります',
		lead: '同じ困りごとなら、「わかる」を付けるだけで十分です。',
		supports: (n: number) => `わかる ${n}`,
		supportThis: 'これに「わかる」を付ける',
		nextDifferent: 'どれとも違うので、次へ',
		failed: '「わかる」を付けられませんでした。もう一度お試しください。'
	},
	/** 統合（設計書 docs/spec/30.md） */
	merge: {
		sourcesHeading: 'この課題にまとめた課題',
		mergedInto: (id: number) => `この課題は #${id} にまとめられました`,
		pageTitle: (id: number) => `この課題は #${id} にまとめられました｜オープンソース立法府`,
		mergedOp: '統合された課題には操作できません',
		target: '統合先の課題の番号',
		check: '確かめる',
		confirm: (sourceId: number, source: string, targetId: number, target: string) =>
			`#${sourceId}「${source}」を #${targetId}「${target}」に統合します。`,
		irreversible: '統合は取り消せません。',
		supports: (n: number) => `合算したあとの「わかる」 ${n}`,
		note: '統合のメモ（公開されます。個人情報は書かないでください）',
		submit: '統合する',
		self: '同じ課題には統合できません',
		sourceNotListed: '非表示か統合済みの課題は統合できません',
		targetInvalid: '統合先が非表示か統合済みか、ありません',
		status: (id: number) => `統合した（#${id}）`,
		logReason: (id: number) => `#${id} にまとめた`
	},
	/** 非表示の課題の見え方 */
	hidden: {
		pageTitle: '非表示の課題｜オープンソース立法府',
		heading: '非表示の課題',
		auto: 'この課題は通報により非表示になっています',
		staff: (reason: string) => `この課題は運営の確認により非表示になっています（理由：${reason}）`,
		toLog: 'くわしくは運営の記録へ',
		staffLink: '運営として対応する'
	},
	/** 非表示の理由（記録と課題のページで使う） */
	hideReasons: {
		reports: '通報が3件',
		attack: '人への攻撃・差別',
		spam: '宣伝・荒らし',
		other: 'その他'
	},
	kanri: {
		pageTitle: '通報を受けた課題｜オープンソース立法府',
		heading: '通報を受けた課題',
		empty: '通報を受けた課題はありません',
		solutionsHeading: '通報を受けた解決策',
		solutionsEmpty: '通報を受けた解決策はありません',
		ownSolution: '自分の解決策には対応できません',
		statuses: { visible: '表示中', auto_hidden: '自動で非表示', hidden: '非表示', restored: '表示に戻した', merged: '統合した' },
		reportCount: (total: number, counted: number) => `通報 ${total}件（数えたもの ${counted}件）`,
		afterRestore: (n: number) => `表示に戻したあとの通報 ${n}件`,
		notes: 'その他の説明',
		hideReason: '非表示にする理由',
		hideNote: '非表示にするメモ（公開されます。個人情報は書かないでください）',
		hide: '非表示にする',
		restoreNote: '表示に戻すメモ（公開されます。個人情報は書かないでください）',
		restore: '表示に戻す',
		alreadyHidden: 'すでに非表示です',
		alreadyShown: '表示されています',
		ownIssue: '自分の課題には対応できません',
		invalid: '入力を確かめてください'
	},
	unei: {
		pageTitle: '運営の記録｜オープンソース立法府',
		heading: '運営の記録',
		criteriaHeading: '非表示にする基準',
		criteria: [
			'登録から24時間たった別々の3人から通報があると、課題や解決策は、運営が確認するまで一時的に見えなくなります。',
			'「同じ課題がほかにある」の通報では見えなくなりません。',
			'運営が確認して問題がないとした課題や解決策は、そのあと通報があっても自動では見えなくなりません。',
			'運営が見えなくするのは、人への攻撃・差別、宣伝・荒らしなど、課題や解決策として扱えないものだけです。理由はこの記録に残します。',
			'通報した人や書いた人の名前は、ここには出しません。'
		],
		logHeading: '対応の記録',
		columns: { at: '日時', issue: '課題', action: '何をしたか', actor: 'だれが', reason: '理由', note: 'メモ' },
		actions: { auto_hide: '自動で非表示', hide: '非表示', restore: '表示に戻した', merge: '統合' },
		actors: { auto: '自動', moderator: '運営協力者', operator: '運営' },
		empty: 'まだ記録はありません',
		/** 解決策への対応の行で、課題の番号のあとに付ける */
		solutionOf: 'の解決策',
		prevPage: '前の50件',
		nextPage: '次の50件'
	},
	issue: {
		listPageTitle: '課題｜オープンソース立法府',
		heading: '課題',
		topLink: '課題を見る',
		write: '課題を書く',
		filterLabel: '表示する課題',
		filterAll: 'すべて',
		filterTopic: '今回のお題',
		filterSolutions: '解決策あり',
		sortLabel: '並び',
		sorts: { support: '「わかる」の多い順', new: '新しい順', rising: '最近「わかる」が増えている順' },
		columnTitle: '課題',
		columnSupports: 'わかる',
		columnTopic: 'お題',
		columnSolutions: '解決策',
		solutions: '解決策',
		supports: 'わかる',
		topicMark: (name: string) => `お題：${name}`,
		empty: 'まだ課題がありません',
		emptyTopic: '今回のお題の課題はまだありません',
		emptySolutions: '解決策のある課題はまだありません',
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
