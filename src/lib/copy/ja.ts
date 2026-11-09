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

/** 投稿の種類の名前 */
const POST_KINDS = { question: '質疑', answer: '答弁', supplement: '補足' };

export const ja = {
	siteName: 'オープンソース立法府',
	unofficial: '国会・政府とは無関係の非公式サービスです',
	/** 全体のメニュー（PcHeader・SpNav、Issue #85） */
	menu: {
		label: 'メニュー',
		tabs: { home: 'ホーム', kadai: '課題', houan: '法案', saiketsu: '採決', hourei: '法律' },
		mine: 'わたしの記録',
		crumbs: 'いまいる場所',
		crumbSeparator: '／',
		/** パンくずの後ろ（そのページの名前）。中身が題名のページは題名を出す */
		pages: {
			issue: '課題の詳細',
			ifLaw: (title: string) => `${title}（IF世界）`
		}
	},
	/** 法律の一覧（/hourei、Issue #85 決めたこと A） */
	laws: {
		pageTitle: '法律｜オープンソース立法府',
		heading: '法律',
		lead: 'ゲームで扱っている法律です。現実の法律と、IF世界の法律を読めます。'
	},
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
	/** 質疑・答弁・補足と自分の考え（Issue #66。SpBillQA・PcBillQA） */
	post: {
		kinds: POST_KINDS,
		reportOpen: { question: 'この質疑を通報する', answer: 'この答弁を通報する', supplement: 'この補足を通報する' },
		reportDone: '通報を受け付けました',
		reportAlready: '通報済みです',
		hiddenOp: '非表示の投稿には操作できません',
		hiddenHeading: '非表示の投稿',
		hiddenAuto: '通報により非表示になっています',
		hiddenStaff: (reason: string) => `運営か委員長の確認により非表示になっています（理由：${reason}）`,
		parentHidden: '質疑が非表示のため出ていません',
		mergedOp: 'この質疑は別の質疑にまとめられました',
		mergedCount: (n: number) => `同じ内容の質疑を${n}件まとめました`,
		mergedHeading: 'まとめられた質疑',
		mergedLink: 'まとめた先の質疑を見る',
		mergedTargetHidden: 'まとめた先の質疑は今は非表示です',
		staffLink: '運営として対応する',
		pageTitle: (title: string) => `${title}の質疑｜オープンソース立法府`,
		writePageTitle: (title: string) => `${title}の質疑を書く｜オープンソース立法府`,
		stanceHeading: 'あなたの今の考え',
		onlyYou: '自分だけに見えます',
		stances: { for: '賛成寄り', undecided: '未定', against: '反対寄り' },
		stanceLeft: (n: number) => `この会期はあと${n}回変えられます`,
		stanceNone: 'この会期はもう変えられません',
		stanceLimit: 'この会期はもう考えを変えられません。',
		filters: '質疑の絞り込み',
		all: 'すべて',
		waitingCount: (n: number) => `答弁待ち ${n}`,
		waiting: '答弁待ち',
		withRelated: '関連法案も',
		fromBill: (title: string) => `「${title}」の質疑`,
		empty: '質疑はまだありません',
		emptyWaiting: '答弁待ちの質疑はありません',
		more: (n: number) => `質疑をもっと見る（${n}件）`,
		writeQuestion: '質疑を書く',
		questionField: '質疑の内容',
		answer: '答弁する',
		answerField: '答弁の内容',
		supplement: '補足する',
		supplementField: '補足の内容',
		send: '送る',
		back: '質疑の一覧に戻る',
		roles: { author: '提出者', cosponsor: '共同提出者', supporter: '賛同者' },
		answerHeading: (role: string) => `答弁（${role}）`,
		supplementHeading: '補足',
		readAnswer: (role: string) => `答弁を読む（${role}）`,
		readAnswers: (n: number) => `答弁を読む（${n}件）`,
		tooNew: (at: number) => `登録から7日たつと、質疑や答弁を書いたり、評価したりできます。${jaDateTime(at)}からできます。`,
		closed: 'いまは書けない時期です。',
		notAnswerer: '答弁できるのは提出者と賛同者だけです。',
		ownQuestion: '自分の質疑には答弁できません。',
		answererSupplement: '提出者と賛同者は、補足ではなく答弁を書いてください。',
		evaluations: { reasonable: '筋が通っている', changed: '考えが変わった' },
		evaluationHint: '考えが違っても、筋が通っていると思えば「筋が通っている」を押してください。',
		ownPost: '自分の投稿には評価を付けられません。',
		evaluationClosed: 'いまは評価できない時期です。',
		evaluationGone: 'この投稿は評価できません。'
	},
	/** 採決（Issue #70。SpVoteList・PcVoteList・SpVote・PcVote）。「有効票」は「数えた票」、「参考票」は「参考の票」と書く */
	vote: {
		listPageTitle: '採決｜オープンソース立法府',
		otherPageTitle: 'ほかの法案の採決｜オープンソース立法府',
		pageTitle: (title: string) => `${title}の採決｜オープンソース立法府`,
		billLink: '投票する',
		heading: '採決',
		/** 開発用の分の会期は時刻、カレンダーの月は0時まで */
		deadline: (s: Session) => `締切 ${s.month === null ? jaTime(s.endsAt) : `${jaDay(s.endsAt)}0時`}`,
		ofVote: 'の採決',
		before: (s: Session) => `採決は${sessionPoint(s, s.voteAt, true)}から始まります。`,
		assigned: '割り当て法案',
		votedSuffix: '投票済み',
		voted: '投票済み',
		notYet: 'まだ',
		toVote: '投票する',
		other: 'ほかの法案にも投票する',
		otherHeading: 'ほかの法案',
		otherLead: '割り当てのほかに、この会期に採決する法案です。',
		otherEmpty: 'ほかに採決する法案はありません。',
		prevPage: '前のページ',
		nextPage: '次のページ',
		pages: 'ほかの法案のページ',
		position: (n: number, total: number) => `割り当て ${n} / ${total}`,
		/** [前, 強調, 後] */
		pending: (total: number): [string, string, string] => [total === 1 ? '割り当ての法案に投票すると、あなたの票が' : `${total}本すべてに投票すると、あなたの票が`, '数えた票', 'になります。'],
		finished: (): [string, string, string] => ['割り当ての法案はすべて投票済みです。あなたの票は', '数えた票', 'になります。'],
		noAssignment: (): [string, string, string] => ['今回は割り当ての法案がありません。あなたの票は', '数えた票', 'になります。'],
		reference: 'このアカウントの票は参考の票として数えます。会期が始まる前日までに登録し、それまでに参加したことのある人の票を、可否に使います。',
		changesCount: (n: number) => `変更点 ${n}か所`,
		changesOpen: 'を見る',
		yourVote: 'あなたの票',
		choices: { yes: '賛成', no: '反対', abstain: '棄権（どちらにも入れない）' },
		choose: '票を選んでください',
		submit: '投票する',
		checking: '確認しています',
		abstainHint: '棄権は、変更点の一覧を開くと選べます。',
		secret: '票の数は締切まで誰にも見えません',
		done: '投票しました。締切までは変えられます。',
		backToList: '採決の一覧へ',
		readQuestions: '質疑を読む',
		amendmentNotice: '修正案が可決すると本文が変わることがあります',
		amendmentLink: '修正案を見る',
		closed: 'いまはこの法案に投票できません。'
	},
	/** 採決の結果（Issue #71。SpResult・PcResult。設計書 docs/spec/71.md） */
	result: {
		pageTitle: (title: string) => `${title}の採決の結果｜オープンソース立法府`,
		crumb: (s: Session) => `${ja.session.name(s)}の結果`,
		link: '結果を見る',
		before: '結果は締切のあとに出ます',
		counting: '結果を集計しています',
		words: { passed: '可決', rejected: '否決', lapsed: '廃案' },
		passedNote: 'IF世界の法律になりました',
		rejectedNote: 'IF世界の法律にはなりません',
		lapsedNote: (quorum: number) => `数えた票が定足数（${quorum}票）に届きませんでした`,
		notice: 'ゲームの中の結果です。世論調査ではありません。',
		reversed: '数えた票と参考の票で、可否が逆になりました',
		same: '結果は数えた票と同じでした',
		counted: (n: number) => `数えた票 ${n}`,
		choices: { yes: '賛成', no: '反対', abstain: '棄権' },
		referenceHeading: '参考の票（可否には使いません）',
		referenceOpen: '参考の票を開く',
		referenceLine: (yes: number, no: number, abstain: number) => `賛成 ${yes} ・ 反対 ${no} ・ 棄権 ${abstain}`,
		amendmentsHeading: '本案より先に採決した修正案',
		amendmentRow: (location: string, status: string) => `${location} ・ ${status}`,
		amendmentsLink: '修正案を見る',
		billLink: '法案のページへ'
	},
	/** 票の偏りの確認（Issue #73。設計書 docs/spec/73.md）。「異常」「検知」「確認中」は画面に出さない */
	review: {
		reviewing: '結果を確認しています',
		voided: '確認の結果、この採決は無効になりました',
		voidedReason: (note: string) => `理由：${note}`,
		signals: { new_accounts: '新しいアカウントの票の集中', same_line: '同じ回線からの票の集中', same_run: '同じ票の連続' },
		kanriHeading: '結果を確認している法案',
		kanriEmpty: '結果を確認している法案はありません',
		kanriWithout: { passed: '可決', rejected: '否決', lapsed: '廃案' },
		kanriDetail: (flagged: number, maxLine: number, longestRun: number, runSeconds: number) => `偏りのある票 ${flagged} ・ 1回線の最大 ${maxLine} ・ 最長の連続 ${longestRun}票（${runSeconds}秒）`,
		withoutLabel: '除いたときの結果：',
		counts: (yes: number, no: number, abstain: number) => `賛成 ${yes} ・ 反対 ${no} ・ 棄権 ${abstain}`,
		involved: '自分が関わった法案は確認できません',
		confirm: '結果を確定する',
		void: 'この採決を無効にする',
		voidNote: '無効にする理由',
		voidHint: '理由は公開します。個人が分かることは書かないでください。',
		invalid: '内容を確かめてください。',
		closed: 'すでに確認された法案です。',
		logHeading: '採決の確認の記録',
		logCriteria: '票の偏りが見つかり、結果を左右するときは、運営が確かめるまで結果を公開しません。回線や人数やアカウントは、ここには出しません。',
		logEmpty: 'まだ記録はありません',
		logColumns: { at: '見つかった日時', bill: '法案', kind: '見つかった偏り', status: 'どうなったか', decidedAt: '対応した日時', actor: 'だれが', note: '理由' },
		logStatus: { noted: '可決かどうかを左右しないので保留していません', open: '結果を確認しています', confirmed: '結果を確定した', voided: '無効にした' },
		logPages: '採決の確認の記録のページ'
	},
	/** IF世界の法令と要調整（Issue #72。SpLaw・PcLaw。設計書 docs/spec/72.md）。「分岐」「反映」は画面に出さない */
	ifLaw: {
		pageTitle: (title: string) => `${title}（IF世界）｜オープンソース立法府`,
		fictional: '架空の法令',
		real: '現実の法律',
		ifWorld: 'IF世界の法律',
		switchLabel: '現実の法律とIF世界の法律',
		changedBy: 'IF世界で変わりました：',
		enactedBy: 'IF世界で新しくできた法律です：',
		repealedBy: 'IF世界では廃止されました：',
		toLaw: 'IF世界の条文を見る',
		/** 法令が2本以上の法案（Issue #53） */
		toLawNamed: (title: string) => `IF世界の条文を見る（${title}）`,
		formNote: 'ここに出る条文は IF世界の最新です（架空の法令）',
		lawRepealed: 'この法令は IF世界で廃止されたので、法案の対象にできません。',
		lawRepealedNamed: (title: string) => `${title}は IF世界で廃止されたので、法案の対象にできません。外すか、ほかの法令を選んでください。`,
		conflictsHeading: 'ぶつかった条文',
		conflictsHint: '基にしたあとで、次の条文が変わりました。いまの条文を確かめて、変更後の条文を見直してください。',
		confirmLabel: 'いまの条文を確かめました',
		confirmRequired: 'いまの条文を確かめて、チェックを入れてください。',
		proposeBlocked: {
			repealed: 'この法令は IF世界で廃止されたので、発議できません。',
			title: '同じ名前の法律が IF世界にできたので、発議できません。法令名を直してください。',
			stale: '基にしたあとで条文が変わりました。編集の画面でいまの条文を確かめてから、発議してください。'
		},
		locked: '要調整の法案は、題名と種類と対象の法令を変えられません。',
		fix: '直す',
		fixHeading: '要調整の法案を直す',
		fixSubmit: '直して質疑に戻す',
		applying: 'IF世界の法律にする手続きをしています',
		adjusting: {
			article: '可決しましたが、先に変わった条と重なるので、調整が要ります。',
			title: '可決しましたが、同じ名前の法律が先にできたので、調整が要ります。'
		},
		repealedNote: '可決しましたが、対象の法令が先に廃止されたので、IF世界の法律になりません。',
		expired: '調整の期限までに直されなかったので、廃案になりました',
		due: (at: number) => `直す期限：${jaDateTime(at)}まで`
	},
	/** 現実の改正の取り込み（設計書 docs/spec/95.md）。「リベース」「同期」は使わない */
	torikomi: {
		pageTitle: (title: string) => `${title}の現実の改正の取り込み（IF世界）｜オープンソース立法府`,
		heading: '現実の改正の取り込み',
		intro: '会期の終わりに、施行された現実の改正を IF世界の法律に取り込みます。IF世界で変えた条は、そのまま残ります。',
		empty: '取り込んだ現実の改正はまだありません',
		enforced: (date: string) => `${jaDate(date)}施行`,
		noChange: '条文の変更はありません',
		amendment: (title: string, num: string | null) => (num ? `${title}（${num}）` : title),
		side: (world: string, label: string) => `${world}：${label}`,
		changedHeading: '変わった条',
		conflictsHeading: 'ぶつかった条文',
		real: '現実の法律',
		ifWorld: 'IF世界の法律',
		realGone: '現実の法律ではなくなりました',
		ifDeleted: 'IF世界では削除されています',
		changes: { amended: '変わりました', renumbered: '番号が変わりました', added: '足されました', removed: 'なくなりました' },
		moved: (before: string, after: string) => `${before}→${after}`,
		changedBy: 'IF世界で変えた法案：',
		mark: '現実の改正とぶつかっています',
		back: 'IF世界の法律に戻る',
		goneRow: 'この条はなくなりました。選び直してください。',
		goneBody: '現実の法律からなくなりました'
	},
	/** IF世界の帯（Issue #63 テストの作り方：SpResult・PcResult の帯に合わせる） */
	ifBand: { label: 'IF世界', short: '架空の法律です', long: 'このページの条文は架空のものです。現実の法律ではありません。' },
	/** 修正案（設計書 docs/spec/68.md）。「先議」は使わず「本案より先に採決」と書く */
	amendment: {
		reportOpen: 'この修正案を通報する',
		hiddenOp: '非表示の修正案には操作できません',
		hiddenHeading: '非表示の修正案',
		pageTitle: (title: string) => `${title}の修正案｜オープンソース立法府`,
		writePageTitle: (title: string) => `${title}の修正案を出す｜オープンソース立法府`,
		write: '修正案を出す',
		update: '更新する',
		updateHeading: (label: string) => `${label}の修正案を更新する`,
		empty: '修正案はまだありません',
		more: (n: number) => `修正案をもっと見る（${n}件）`,
		back: '修正案の一覧に戻る',
		coDrafterNotice: '採用されると、共同起草者として名前が出ます。',
		articleField: '変える条',
		articlePlaceholder: '選んでください',
		bodyField: '変更後の条文',
		reasonField: '理由（任意）',
		before: 'もとの本案',
		currentBill: 'いまの本案の条文',
		after: '修正案',
		reason: '理由',
		accept: '取り込む',
		acceptDeadline: '取り込めるのは採決の24時間前までです',
		supportAdd: '賛同する',
		supportRemove: '賛同を取り消す',
		supportLine: (n: number, left: number) => (left > 0 ? `賛同 ${n}人（あと ${left}人で本案より先に採決します）` : `賛同 ${n}人（本案より先に採決します）`),
		needsUpdate: '更新が必要です',
		voting: '本案より先に採決します',
		notVoted: '採決されません',
		awaiting: '結果を待っています',
		statuses: {
			accepted: '取り込まれました',
			passed: '可決',
			failed: '否決',
			superseded: '可決しましたが、同じ条の修正案が先に可決しました',
			lapsed: '定足数に届きませんでした',
			unvoted: '採決されませんでした'
		},
		secret: '票の数は締切まで誰にも見えません',
		reference: '参考の票として数えます',
		choices: { yes: '賛成', no: '反対', abstain: '棄権' },
		vote: '投票する',
		tooNew: (at: number) => `登録から7日たつと、修正案を出したり賛同したりできます。${jaDateTime(at)}からできます。`,
		closed: 'いまは修正案を出したり賛同したりできない時期です。',
		voteClosed: 'いまは修正案に投票できない時期です。',
		notVoting: 'この修正案は採決されません。',
		acceptClosed: 'いまは取り込めない時期です。取り込めるのは採決の24時間前までです。',
		invalid: '入力の形が正しくありません。もう一度お試しください。',
		author: '提出者は修正案を出せません。',
		notAuthor: '取り込めるのは提出者だけです。',
		ownSupport: '提案者と提出者は賛同できません。',
		notMine: '更新できるのは提案者だけです。',
		noUpdate: 'この修正案は更新できません。',
		stale: 'この修正案か本案が変わりました。読み直してください。',
		staleForm: '本案が変わりました。読み直してから書いてください。',
		unchanged: 'いまの本案と同じ本文です。',
		unchangedOnUpdate: 'いまの本案と同じ本文になっているので、更新は要りません。',
		sameAsBase: '基にした条文と同じです。変更をやめる修正案は出せません。',
		noArticles: 'この法案には、修正案で変えられる条がありません。'
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
		formInvalid: '送られた内容を読み取れませんでした。ページを読み直してください。',
		lawRequired: '対象の法令を選んでください。',
		lawDuplicate: 'ほかの枠と同じ法令です。別の法令を選ぶか、この法令を外してください。',
		lawTitleExists: '同じ名前の法律があります。別の名前にしてください。',
		fixErrors: '入力を直してください。誤りはそれぞれの欄のそばに出しています。',
		baseChanged: '条文が新しくなりました。開き直してください。',
		stale: '別の画面で先に保存されました。開き直してください。',
		tooNew: (at: number) => `登録から7日たつと、法案を書けます。${jaDateTime(at)}から書けます。`,
		/** 書く画面（Issue #46。キャンバスに案がないので SpBillChanges の形で組む） */
		write: {
			pageTitle: '法案を書く｜オープンソース立法府',
			editPageTitle: (title: string) => `${title}を直す｜オープンソース立法府`,
			heading: '法案を書く',
			editHeading: '法案の下書きを直す',
			start: '法案は、課題の解決策から書き始めます。課題のページで、解決策の「この解決策から法案を書く」を押してください。',
			toIssues: '課題の一覧へ',
			kind: '種類',
			kindFixed: '種類は、書き始めたあとは変えられません。',
			title: '題名',
			titleHint: '法案の中身がひと目でわかる名前にします。正式名は種類と法令から自動で付きます。',
			law: '対象の法令',
			lawPlaceholder: '選んでください',
			changes: '変える条',
			changesHint: '条ごとに、書きかえ・新しく追加・削除を選びます。50条まで並べられます。',
			row: (n: number) => `変更 ${n}`,
			op: '変え方',
			target: '変える条',
			targetPlaceholder: '条を選んでください',
			num: '足す条の番号',
			numHint: '「第3条の2」のように、前の条の枝番で書きます。',
			caption: '見出し',
			body: '変更後の条文',
			bodyHint: '2項からは行頭に半角の「2」と全角の空白、号は「一」と全角の空白を付けます。',
			loading: '条文を読み込んでいます…',
			loadFailed: '条文を読み込めませんでした。法令を選び直してください。',
			chooseLawFirst: '先に対象の法令を選んでください。',
			addRow: '変える条を足す',
			removeRow: 'この変更を外す',
			repealNote: '廃止の法案は、選んだ法令をまるごと廃止します。変える条は選びません。',
			/** 2本以上の法令（Issue #53） */
			addLaw: 'ほかの法令も変える',
			removeLaw: 'この法令を外す',
			otherLaw: (n: number) => `ほかの法令 ${n}`,
			relatedLaw: (n: number) => `関連する法令 ${n}`,
			lawOnly: '法令',
			lawHint: {
				amend: '1本の法案で、この法令もまとめて改正します。',
				enact: '新しい法律の附則で、この法令を改正する形になります。',
				repeal: '廃止の法案の附則で、この法令を廃止するか、一部を改正する形になります。'
			},
			action: '扱い',
			actions: { repeal: '廃止する', amend: '一部を改正する' },
			/** ほかの課題の解決策を探す（Issue #53） */
			searchLabel: 'ほかの課題の解決策を探す',
			searchButton: '探す',
			searchResults: '探した結果',
			choose: '選ぶ',
			chosen: '選んだ解決策',
			noResults: '当てはまる解決策はありません。',
			moreResults: '多いので一部だけを出しています。言葉を足して絞ってください。',
			searchFailed: '探せませんでした。もう一度お試しください。',
			issueOf: (title: string) => `課題：${title}`,
			/** 制定（Issue #47） */
			newTitle: '法令名',
			newTitleHint: '末尾は「法」か「法律」にします。正式名は「法令名＋案」になります。',
			enactHeading: '新しい法律の条',
			enactHint: '第1条は目的です。条の番号は順に自動で付きます。',
			article: (n: number) => `第${n}条`,
			articleBody: '条文',
			addArticle: '条を足す',
			removeArticle: 'この条を外す',
			/** ひな形の本文。mark は書きかえてもらう印（domain/bills.ts の ENACT_PLACEHOLDER） */
			enactTemplateBody: (mark: string) => `この法律は、${mark}することを目的とする。`,
			affected: '誰が困っているか',
			sideEffects: '副作用',
			summary: '3行要約（任意）',
			summaryHint: '1行に1つ、3行まで書けます。',
			supplementary: '附則（任意）',
			supplementaryHint: 'いつから始めるかなどを書きます。',
			solutions: '元になった解決策',
			solutionsHint: '5つまで選べます。',
			solutionsDropped: (n: number) => `非表示になった解決策${n}件は、保存すると引用から外れます。`,
			noCandidates: '引用できる解決策がなくなったので、この下書きは保存できません。',
			submit: '下書きを保存する',
			cancel: 'やめる'
		},
		kinds: { amend: '改正', repeal: '廃止', enact: '制定' },
		ops: { amend: '書きかえ', add: '新しく追加', delete: '削除', supplementary: '新しく追加' },
		/** 法案のいまの進み（Issue #50。一覧の言葉は list.stages） */
		progress: { draft: '下書き', proposed: '発議', deliberation: '質疑', vote: '採決', lapsed: '廃案', withdrawn: '撤回', passed: '可決', rejected: '否決', counting: '集計中', adjusting: '要調整', reviewing: '結果を確認しています' },
		/** 賛同と発議（Issue #49） */
		support: {
			count: (n: number) => `賛同 ${n}人`,
			separator: ' ・ ',
			add: '賛同する',
			remove: '賛同を取り消す',
			propose: '発議する',
			remaining: (n: number) => `発議にはあと${n}人`,
			tooNew: (at: number) => `登録から7日たつと、賛同と発議ができます。${jaDateTime(at)}からできます。`,
			stale: 'この法案は直されました。読み直してから賛同してください。',
			staleRemove: 'この法案は直されたので、前の賛同は数えていません。ページを読み直してください。',
			closed: 'この法案は発議されたので、賛同の受け付けを終えました。',
			author: '自分の法案には賛同できません。',
			notAuthor: '発議できるのは提出者だけです。',
			short: '賛同が足りないので、まだ発議できません。',
			resetNotice: (n: number) => `保存すると、いまの賛同 ${n}人は数えなくなります。集め直しになります。`
		},
		/** 法案の書き方のページ（Issue #59）。数はルールの値から渡す */
		howto: {
			pageTitle: '法案の書き方｜オープンソース立法府',
			heading: '法案の書き方',
			lead: '課題と解決策から法案を書き、発議して採決されるまでの流れと、書き方の決まりです。',
			toc: '目次',
			sections: {
				flow: '法案ができるまで',
				start: '書き始める',
				kinds: '法案の種類',
				articles: '変える条の書き方',
				laws: '2本以上の法令',
				propose: '発議まで',
				after: '発議のあと'
			},
			flow: (proposeUntil: number, deliberation: number, vote: number) => [
				'だれかが課題を出し、ほかの人が解決策を出します。',
				'解決策から、法案の下書きを書きます。',
				`賛同を集めて発議します（毎月${proposeUntil}日まで）。`,
				`委員会で質疑をします（毎月${deliberation}日から）。`,
				`採決します（毎月${vote}日から月末まで）。`,
				'可決すると、IF世界の法律になります。'
			],
			flowNote: '会期は1か月です。月ごとに、この流れを繰り返します。',
			start: (days: number, solutions: number) => [
				'課題のページで、解決策の「この解決策から法案を書く」を押すと書き始められます。',
				`法案を書けるのは、登録から${days}日たってからです。`,
				`元になった解決策は${solutions}つまで選べます。ほかの課題の解決策も、書く画面で探して足せます。`
			],
			kinds: [
				'改正：いまの法令の条を、書きかえ・新しく追加・削除します。',
				'廃止：法令をまるごと廃止します。変える条は選びません。',
				'制定：新しい法律を作ります。法令名は「法」か「法律」で終わるようにし、第1条には目的を書きます（見出しは「（目的）」）。'
			],
			kindsNote: '改正で選べる条文は、IF世界の最新の条文です（架空の条文を含みます）。',
			articles: [
				'条を選ぶと、いまの見出しと条文が欄に入ります。変えたいところだけを直します。',
				'1行目は第1項です。2項からは行頭に半角の「2」と全角の空白を、号は「一」と全角の空白を付けます（全角の「２」は前の項の続きになります）。'
			],
			articlesExample: '事業者は、契約を結ぶ前に、次の事項を示さなければならない。\n一　契約の期間\n二　解約の方法\n2　前項の事項は、分かりやすく示さなければならない。',
			articlesExampleLabel: '書き方の例',
			articlesAdd: '新しく追加する条は、前の条の枝番で「第3条の2」のように番号を決めます。',
			laws: (laws: number, changes: number) => [
				`1本の法案で、法令を${laws}本まで扱えます。`,
				'改正の法案で「ほかの法令も変える」を押すと、まとめて改正できます（「○○法等の一部を改正する法律案」になります）。',
				'制定と廃止の法案では、附則で関連する法令を改正する形になります。',
				`変える条は、法案全体で${changes}条までです。`
			],
			propose: (percent: number, min: number, until: number) => [
				'下書きは何度でも直せます。共同提出者になった人も直せます。',
				`発議するには、今月の参加者の${percent}%（最低${min}人）の賛同が要ります。下書きを直すと、賛同は集め直しになります。`,
				`その月の審議に回るのは、毎月${until}日までに発議した法案です。${until + 1}日からの発議は、次の会期の審議に回ります。`
			],
			after: [
				'質疑の週に、ほかの人の質問に答弁します。ほかの人は、条ごとに修正案を出せます。',
				'採決の週に投票があり、結果が出ます。',
				'可決しても、先に変わった条とぶつかったときは、期限までに直すと次の会期に回ります。直さなければ廃案になります。'
			],
			startFrom: '法案は、課題の解決策から書き始めます。',
			toIssues: '課題の一覧へ'
		},
		/** 法案の一覧（SpBills・PcBills） */
		list: {
			pageTitle: '法案｜オープンソース立法府',
			heading: '法案',
			howto: '法案の書き方を見る',
			tabs: '法案のタブ',
			shingi: (n: number) => `審議中 ${n}`,
			shitagaki: (n: number) => `下書き ${n}`,
			owari: '終わった',
			kind: '種類',
			bill: '法案',
			stage: '段階',
			stages: { draft: '下書き', proposed: '発議', deliberation: '質疑中', vote: '採決中', lapsed: '廃案', withdrawn: '撤回', passed: '可決', rejected: '否決', counting: '集計中', adjusting: '要調整', reviewing: '結果を確認しています' },
			support: '賛同',
			supportCell: (n: number) => `${n}人`,
			supportPrefix: ' ・ 賛同 ',
			empty: { shingi: '審議中の法案はありません。', shitagaki: '下書きはありません。', owari: '終わった法案はありません。' },
			pages: 'ページ送り',
			prevPage: '前のページ',
			nextPage: '次のページ'
		},
		staleRead: 'ほかの人が保存しました。読み直してください。',
		/** 共同提出者（設計書 docs/spec/76.md） */
		cosponsor: {
			heading: '共同提出者',
			names: (names: string[]) => `共同提出者 ${names.join('、')}`,
			request: '共同提出者になりたいと申し出る',
			requestNote: '提出者が承認すると、この法案を一緒に編集し、答弁できます。承認されると賛同は外れます（賛同していたことが分かる場合があります）。承認のあとで抜けても、この法案には賛同も修正案もできません。',
			cancel: '申し出を取り下げる',
			accept: '承認する',
			decline: '断る',
			remove: '外す',
			removeConfirm: '外すと元に戻せません',
			leave: '共同提出者から抜ける',
			leaveConfirm: '抜けると元に戻せません。この法案には賛同も修正案もできなくなります',
			requestsHeading: '申し出',
			membersHeading: '共同提出者',
			none: '共同提出者の申し出はまだありません',
			more: (n: number) => `ほかに ${n} 件の申し出があります`,
			fullNote: '共同提出者は5人までです',
			leftNote: '共同提出者から抜けた法案です',
			declinedNote: '申し出は断られました',
			cosponsor: '共同提出者は賛同できません。',
			formerCosponsor: '共同提出者だった法案には賛同できません。',
			refused: {
				author: '提出者は申し出できません。',
				closed: '発議のあとは変えられません。読み直してください。',
				left: '共同提出者から抜けた法案には申し出できません。',
				declined: '申し出は断られました。',
				forbidden: 'この操作はできません。',
				full: '共同提出者は5人までです。'
			}
		},
		/** 撤回（設計書 docs/spec/76.md） */
		withdraw: {
			heading: '撤回',
			progress: (total: number, n: number) => `${total}人中${n}人が同意`,
			names: (names: string[]) => `（${names.join('、')}）`,
			consent: '撤回に同意する',
			confirm: '撤回は元に戻せません。提出者と共同提出者の全員が同意すると撤回になります',
			cancel: '同意を取り消す',
			done: '撤回されました',
			result: 'この法案は撤回されました',
			closed: '採決が始まった法案や、撤回された法案は変えられません。',
			forbidden: '提出者と共同提出者だけが同意できます。'
		},
		/** 統合案（設計書 docs/spec/76.md） */
		merge: {
			heading: '統合案',
			start: '統合案を作る',
			create: '統合案を作る',
			withLabel: '相手の法案の番号',
			startNote: 'この法案を複製した統合案の下書きを作ります。元の法案の提出者と共同提出者の全員が同意すると発議でき、発議すると元の法案は撤回になります。',
			link: '統合案：',
			mergedInto: '統合案に統合されました：',
			separator: '、',
			waiting: '（同意待ち）',
			progress: (total: number, n: number) => `${total}人中${n}人が同意`,
			consent: '統合案に同意する',
			consentNote: '読んでいるこの版に同意します。同意すると統合案の共同提出者になり（賛同していれば外れます）、抜けてもこの統合案には賛同も修正案もできません。統合案を一緒に書くのは、普通の申し出と承認でできます。統合案が保存されると同意は集め直しになります。',
			consentConfirm: '発議されると、元の法案は撤回になります',
			revoke: '同意を取り消す',
			cancel: '統合案をやめる',
			merge: '元の法案の提出者全員の、いまの版への同意が要ります。',
			mergeClosed: '元の法案が取り下げられない状態になったので、統合案として発議できません。統合案をやめると普通の下書きに戻ります。',
			refused: {
				forbidden: 'この操作はできません。',
				closed: 'この組では統合案を作れないか、すでに変えられません。',
				stale: 'ほかの人が保存しました。読み直してください。',
				full: '共同提出者は5人までです。'
			}
		},
		/** 出し直し（設計書 docs/spec/75.md） */
		resubmit: {
			button: '出し直す',
			note: '中身を複製した新しい下書きを作ります。賛同は集め直します。',
			open: '出し直した法案を開く',
			origin: '元の法案：',
			fromResult: '法案のページで出し直す',
			notAuthor: '提出者だけが出し直せます。',
			closed: 'この法案は出し直せません。'
		},
		/** 法案のページ（SpBillSummary・SpBillChanges・PcBillSummary・PcBillChanges） */
		page: {
			pageTitle: (title: string) => `${title}｜オープンソース立法府`,
			changesPageTitle: (title: string) => `${title}の変更点｜オープンソース立法府`,
			tabs: '法案のページ',
			summaryTab: '概要',
			changesTab: (n: number) => `変更点 ${n}`,
			questionsTab: (n: number) => `質疑 ${n}`,
			amendmentsTab: (n: number) => `修正案 ${n}`,
			relatedHeading: '関連法案',
			relatedNote: '同じ条文を変える法案です',
			now: 'いま：',
			stagesHeading: 'いまの段階',
			stages: ['下書き', '発議', '委員会へ', '質疑', '採決', '結果'],
			here: '（いまここ）',
			/** スマホの「いま：」の次の行（docs/spec/50.md 決めたこと6） */
			nextLine: (name: string, s: Session, at: number) => `${name}は${sessionPoint(s, at, false)}から`,
			/** PC の段の日付（PcBillSummary） */
			stageFrom: (name: string, s: Session, at: number) => `${name}（${sessionPoint(s, at, false)}から）`,
			summaryHeading: '3行でいうと',
			affected: '誰が困っているか',
			sideEffects: '副作用',
			solutions: '元になった解決策',
			hiddenSolution: 'この解決策は非表示になっています',
			author: (name: string) => `提出者 ${name}`,
			coDrafters: (names: string[]) => `共同起草者 ${names.join('、')}`,
			edit: '編集する',
			legendDel: '−消す',
			legendIns: '＋足す',
			place: '場所',
			after: '変更後',
			before: 'いま',
			none: '（なし）',
			deleted: '削除',
			supplementary: '附則',
			changeHeading: (n: number | null, location: string, op: string) => `${n === null ? '' : `${n}. `}${location} ・ ${op}`,
			repeal: (title: string) => `${title}をまるごと廃止します。`,
			/** 条文全体のなかで見る（Issue #54） */
			fullTextLink: '条文全体のなかで見る',
			fullTextTitle: (bill: string, law: string) => `${law}（${bill}）の条文全体｜オープンソース立法府`,
			fullTextCrumb: '条文全体',
			fullTextNote: 'この法案が基にした条文に、変更点を重ねて出しています（架空の条文を含みます）。',
			fullTextBack: '変更点に戻る',
			fullTextLaws: '法令',
			fullTextChanged: '変わる条',
			fullTextRow: (location: string, op: string) => `${location} ・ ${op}`
		},
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
			enactPlaceholder: '「○○」を書きかえてください。',
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
			`制限を何度も超えたため、${jaDateTime(until)}まで、課題や解決策の投稿、「わかる」「考えが変わった」、通報ができません。法案の下書きを作ること、保存すること、賛同、発議、質疑、修正案、投票もできません。`,
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
			'reaction-ip': 'この回線からは、この解決策にこれ以上押せません。',
			'bill-draft-account': '法案の下書きは24時間に3件まで作れます。しばらくしてからお試しください。',
			'bill-draft-ip': 'この回線から作れる法案の下書きの数を超えました。しばらくしてからお試しください。',
			'bill-save-account': '法案の下書きの保存は24時間に60回までです。しばらくしてからお試しください。',
			'question-day': '質疑は24時間に10件まで書けます。しばらくしてからお試しください。',
			'answer-day': '答弁は24時間に30件まで書けます。しばらくしてからお試しください。',
			'supplement-day': '補足は24時間に10件まで書けます。しばらくしてからお試しください。',
			'bill-post-burst': '短いあいだに質疑や答弁を何度も書きました。しばらくしてからお試しください。',
			'bill-post-ip': 'この回線から書ける質疑や答弁の数を超えました。しばらくしてからお試しください。',
			'evaluation-day': '評価は24時間に100回まで押せます（取り消しも1回に数えます）。しばらくしてからお試しください。',
			'evaluation-burst': '短いあいだに評価を何度も押しました。しばらくしてからお試しください。',
			'evaluation-ip': 'この回線からは、この投稿にこれ以上評価を付けられません。',
			'amendment-account': '修正案は24時間に5件まで出せます（更新も数えます）。しばらくしてからお試しください。',
			'amendment-ip': 'この回線から出せる修正案の数を超えました。しばらくしてからお試しください。',
			'vote-day': '票を入れたり変えたりできるのは24時間に100回までです。しばらくしてからお試しください。',
			'vote-burst': '短いあいだに票を何度も入れました。しばらくしてからお試しください。',
			'vote-ip': 'この回線から入れられる票の数を超えました。しばらくしてからお試しください。',
			'chair-vote-ip': 'この回線からは、この選挙にこれ以上票を入れられません。',
			'recall-ip': 'この回線からは、この解任動議にこれ以上署名できません。',
			'amendment-support-day': '修正案への賛同は24時間に30回まで押せます（取り消しも1回に数えます）。しばらくしてからお試しください。',
			'amendment-support-burst': '短いあいだに修正案への賛同を何度も押しました。しばらくしてからお試しください。',
			'amendment-support-ip': 'この回線からは、この修正案にこれ以上賛同できません。',
			'bill-cosponsor-day': '共同提出者の申し出は24時間に30回までです。しばらくしてからお試しください。',
			'bill-support-day': '賛同は24時間に30回まで押せます（取り消しも1回に数えます）。しばらくしてからお試しください。',
			'bill-support-burst': '短いあいだに賛同を何度も押しました。しばらくしてからお試しください。',
			'bill-support-ip': 'この回線からは、この法案にこれ以上賛同できません。'
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
		criteria: '登録から24時間たった別々の3人から通報があると、運営か委員長が確認するまで一時的に見えなくなります。',
		/** 質疑・答弁・補足の通報の欄 */
		postCriteria: '登録から24時間たった別々の3人から通報があると、運営か委員長が確認するまで一時的に見えなくなります。その法案の提出者、賛同者、共同提出者の通報は数えません。',
		/** 修正案の通報の欄 */
		amendmentCriteria: '登録から24時間たった別々の3人から通報があると、運営か委員長が確認するまで一時的に見えなくなります（採決の24時間前から結果が出るまでは自動で見えなくなりません）。その法案の提出者、賛同者、共同提出者と、同じ法案に修正案を出した人、賛同している人の通報は数えません。',
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
		toBill: 'この解決策から法案を書く',
		hiddenAuto: 'この解決策は通報により非表示になっています',
		hiddenStaff: (reason: string | null) =>
			reason === null
				? 'この解決策は運営か委員長の確認により非表示になっています'
				: `この解決策は運営か委員長の確認により非表示になっています（理由：${reason}）`,
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
		placeholder: '例：自転車',
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
		staff: (reason: string) => `この課題は運営か委員長の確認により非表示になっています（理由：${reason}）`,
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
	notifications: {
		pageTitle: '通知｜オープンソース立法府',
		heading: '通知',
		entry: (n: number) => `通知（未読 ${n}件）`,
		empty: 'まだ通知はありません。',
		unread: '未読',
		nextPage: '次のページ',
		at: (ms: number) => jaDateTime(ms),
		kinds: {
			bill_proposed: (t: string) => `法案「${t}」が発議されました。`,
			bill_passed: (t: string) => `法案「${t}」は可決されました。`,
			bill_rejected: (t: string) => `法案「${t}」は否決されました。出し直せるかは法案のページで確かめられます。`,
			bill_lapsed: (t: string) => `法案「${t}」は定足数に届かず廃案になりました。出し直せるかは法案のページで確かめられます。`,
			bill_reviewing: (t: string) => `法案「${t}」の結果を確認しています。`,
			bill_voided: (t: string) => `法案「${t}」の結果は無効になりました。`,
			bill_adjustment: (t: string) => `可決された法案「${t}」は、ほかの変更とぶつかりました。期限までに直す必要があります。`,
			bill_law_repealed: (t: string) => `可決された法案「${t}」は、対象の法律がすでに廃止されたので、IF世界の法律になりません。`,
			bill_adjusted: (t: string) => `賛同した法案「${t}」が、ぶつかったところを直して発議し直されました。賛同はそのまま数えます。`,
			bill_conflict: (t: string) => `法案「${t}」は、発議のあとの変更とぶつかっています。可決しても、そのままではIF世界の法律になりません。`,
			cosponsor_requested: (t: string) => `法案「${t}」に共同提出者の申し出がありました。`,
			cosponsor_left: (t: string) => `法案「${t}」の共同提出者が抜けました。`,
			cosponsor_accepted: (t: string) => `法案「${t}」の共同提出者になりました。`,
			cosponsor_declined: (t: string) => `法案「${t}」への共同提出者の申し出は断られました。`,
			cosponsor_removed: (t: string) => `法案「${t}」の共同提出者から外れました。`,
			withdraw_requested: (t: string) => `法案「${t}」の撤回に同意を求められています。`,
			bill_withdrawn: (t: string) => `法案「${t}」は撤回されました。`,
			merge_requested: (t: string) => `統合案「${t}」に同意を求められています。`,
			merge_proposed: (t: string) => `統合案「${t}」が発議されました。`,
			bill_edited: (t: string) => `賛同や同意をした法案「${t}」が直されました。賛同や同意はもう一度必要です。`,
			mind_changed_post: (t: string) => `法案「${t}」のあなたの投稿に「考えが変わった」が付きました。`,
			mind_changed_solution: (t: string) => `課題「${t}」のあなたの解決策に「考えが変わった」が付きました。`,
			issue_hidden: (t: string) => `あなたの課題「${t}」が非表示になりました。理由は課題のページで読めます。`,
			issue_restored: (t: string) => `あなたの課題「${t}」が表示に戻りました。`,
			issue_merged: (t: string) => `あなたの課題「${t}」は、似た課題に統合されました。`,
			solution_hidden: (t: string) => `課題「${t}」のあなたの解決策が非表示になりました。`,
			solution_restored: (t: string) => `課題「${t}」のあなたの解決策が表示に戻りました。`,
			post_hidden: (t: string) => `法案「${t}」のあなたの投稿が非表示になりました。理由は質疑のタブで読めます。`,
			post_restored: (t: string) => `法案「${t}」のあなたの投稿が表示に戻りました。`,
			question_merged: (t: string) => `法案「${t}」のあなたの質疑がまとめられました。まとめた先は質疑のタブで分かります。`,
			amendment_hidden: (t: string) => `法案「${t}」のあなたの修正案が非表示になりました。理由は修正案のタブで読めます。`,
			amendment_restored: (t: string) => `法案「${t}」のあなたの修正案が表示に戻りました。`,
			chair_elected: () => '委員長選挙で委員長に選ばれました。',
			director_elected: () => '委員長選挙で理事に選ばれました。',
			chair_recalled: () => '委員長が解任されました。',
			chair_vote_removed: () => '投票した候補が立候補を取り下げました。もう一度投票できます。',
			vote_open: () => '採決が始まりました。',
			election_open: () => '委員長選挙が始まりました。',
			my_bill_deliberation: (t: string) => `法案「${t}」の質疑が始まりました。`,
			my_bill_vote: (t: string) => `法案「${t}」の採決が始まりました。`,
			my_bill_expired: (t: string) => `法案「${t}」は、期限までに直されなかったので廃案になりました。`,
			acting: () => '委員長の不在が7日続いたので、理事として通報や確認に対応できます。'
		}
	},
	chair: {
		pageTitle: '委員会｜オープンソース立法府',
		heading: '委員会',
		link: '委員会',
		panelHeading: '委員長と理事',
		chair: '委員長',
		directors: '理事',
		none: '今月は委員長がいません。運営が事務局を務めています。',
		settling: '選挙の結果を集計しています。',
		recalled: '解任されました',
		acting: '理事が代行しています',
		backToOffice: '理事がいないので、運営が事務局を務めています。',
		manage: '通報と確認の対応の画面へ',
		loginHint: 'ログインすると、立候補、投票、解任の署名ができます。',
		login: 'ログインする',
		election: {
			heading: '次の会期の委員長選挙',
			before: (at: number) => `${jaDateTime(at)}から立候補と投票ができます。`,
			period: (candidacyEnd: number, ends: number) => `立候補は${jaDateTime(candidacyEnd)}まで、投票は${jaDateTime(ends)}までです。`,
			votingOnly: (ends: number) => `立候補は締め切りました。投票は${jaDateTime(ends)}までです。`,
			rule: '最も多く票が入った人が委員長に、次の3人までが理事になります。結果は委員長と理事の名前だけを公開します。',
			candidates: '候補',
			noCandidates: 'まだ候補はいません。',
			stand: '立候補する',
			standHelp: 'この会期に質疑か答弁を書いた人が立候補できます。',
			withdraw: '立候補を取り下げる',
			withdrawNote: '取り下げると、あなたに入った票も消えます。',
			vote: '投票する',
			checking: '確認しています',
			choose: '候補を選んでください',
			voted: '票を入れました。締切まで変えられます。',
			secret: 'だれがだれに入れたかは公開しません。',
			votedAgain: '候補を選び直すと、票を変えられます。'
		},
		blocks: {
			closed: 'いまはこの操作ができません。',
			staff: '運営と運営協力者は、委員長の選挙と解任動議に関わりません。',
			consecutive: '委員長を2会期続けて務めたので、次の会期には立候補できません。',
			noPost: 'この会期に質疑か答弁を書いた人が立候補できます。',
			ineligible: '今回は投票できません。会期が始まる前に登録し、そのときまでに投稿や賛同などをしている人が投票できます。',
			forbidden: '委員長と理事は署名できません。',
			noCandidate: 'その候補には入れられません。立候補を取り下げたかもしれません。',
			recallIneligible: '今回は署名できません。会期が始まる前に登録し、そのときまでに投稿や賛同などをしている人が署名できます。'
		},
		recall: {
			heading: '解任動議',
			rule: '今月の参加者の20%（最低10人）の署名が集まると、委員長は解任されます。解任は元に戻せません。',
			count: (signatures: number, required: number) => `署名 ${signatures}人／必要 ${required}人`,
			sign: '解任に署名する',
			cancel: '署名を取り消す',
			signed: '署名しました。解任の前なら取り消せます。',
			secret: 'だれが署名したかは公開しません。'
		},
		tooNew: (at: number) => `登録から7日たつと、立候補、投票、解任の署名ができます。${jaDateTime(at)}からできます。`,
		invalid: '入力を確かめてください'
	},
	kanri: {
		pageTitle: '通報を受けた課題｜オープンソース立法府',
		heading: '通報を受けた課題',
		empty: '通報を受けた課題はありません',
		solutionsHeading: '通報を受けた解決策',
		solutionsEmpty: '通報を受けた解決策はありません',
		ownSolution: '自分の解決策には対応できません',
		postsHeading: '通報を受けた質疑・答弁・補足',
		postsEmpty: '通報を受けた質疑・答弁・補足はありません',
		postOf: (kind: string) => `の${kind}`,
		ownPost: '自分の投稿には対応できません',
		involvedPost: '関わった法案の投稿には対応できません',
		mergeHeading: '似た質疑をまとめる',
		mergeIrreversible: 'まとめると元に戻せません。元の質疑は一覧から消え、答弁と補足はまとめた先に移ります。',
		mergeTarget: 'まとめる先の質疑',
		mergeNote: 'まとめるメモ（公開されます。個人情報は書かないでください）',
		mergeSubmit: 'まとめる',
		mergeClosed: 'まとめられるのは、いまの会期の3週目と4週目の質疑だけです',
		mergeNoCandidates: 'まとめられる質疑がほかにありません',
		mergeDone: '質疑をまとめました',
		mergeInvalid: 'まとめる先が同じ法案と会期の表示中の質疑でないか、通報を受けて確認を待っています',
		amendmentsHeading: '通報を受けた修正案',
		amendmentsEmpty: '通報を受けた修正案はありません',
		amendmentOf: (location: string) => `の修正案（${location}）`,
		ownAmendment: '自分の修正案には対応できません',
		involvedAmendment: '関わった法案の修正案には対応できません',
		updatedAfterReport: '最後の通報のあとに本文が更新されました',
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
			'登録から24時間たった別々の3人から通報があると、課題や解決策は、運営か委員長が確認するまで一時的に見えなくなります。',
			'法案の質疑、答弁、補足、修正案も同じです。ただし、その法案の提出者、賛同者、共同提出者の通報は数えません。修正案は、同じ法案に修正案を出した人と賛同している人の通報も数えません。',
			'修正案は、採決の24時間前から結果が出るまで、通報では自動で見えなくなりません。非表示のまま採決の締切を過ぎた修正案は採決されません。',
			'「同じ課題がほかにある」の通報では見えなくなりません。',
			'運営か委員長が確認して問題がないとした投稿は、そのあと通報があっても自動では見えなくなりません。',
			'運営や委員長が見えなくするのは、人への攻撃・差別、宣伝・荒らしなど、投稿として扱えないものだけです。理由はこの記録に残します。',
			'通報した人や書いた人の名前は、ここには出しません。'
		],
		logHeading: '対応の記録',
		postLogHeading: '法案の質疑と修正案への対応',
		postLogPages: '法案の質疑と修正案への対応のページ',
		logKinds: { ...POST_KINDS, amendment: '修正案' },
		postColumns: { at: '日時', bill: '法案', kind: '何か', action: '何をしたか', actor: 'だれが', reason: '理由', note: 'メモ' },
		columns: { at: '日時', issue: '課題', action: '何をしたか', actor: 'だれが', reason: '理由', note: 'メモ' },
		actions: { auto_hide: '自動で非表示', hide: '非表示', restore: '表示に戻した', merge: '統合' },
		actors: { auto: '自動', moderator: '運営協力者', operator: '運営', chair: '委員長', director: '理事' },
		empty: 'まだ記録はありません',
		/** 解決策への対応の行で、課題の番号のあとに付ける */
		solutionOf: 'の解決策',
		prevPage: '前の50件',
		nextPage: '次の50件'
	},
	issue: {
		listPageTitle: '課題｜オープンソース立法府',
		heading: '課題',
		write: '課題を書く',
		filterLabel: '表示する課題',
		filterAll: 'すべて',
		filterTopic: '今回のお題',
		filterSolutions: '解決策あり',
		sortLabel: '並び',
		sortLabelPc: '並び順',
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
