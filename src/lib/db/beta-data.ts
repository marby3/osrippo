// β の規模のデータ（Issue #201。#190 決めたこと6、#198 の「負荷試験」）：参加者100人、課題50件、法案10本と票。
// ステージングにはログインがないので、本物の送信先を通さずに、時刻を「いま」に合わせた行を SQL で作る（シミュレーションは src/lib/simulate/）。
// 行はすべて β の利用者（id が beta- で始まる）が書いたもの。番号は DB に振らせ、ほかの行からは題名・本文で副問い合わせして引く
// （固定の番号を使うと、ステージングの行とぶつかったり、あとの番号が飛んだりするため）。
// 会期は「いま」の会期と前の会期。法案はどれも否決になる票にする（可決すると IF世界の条文が変わり、消すだけでは戻せないため）。
// 前の会期の結果の行（bill_results）も入れる（統計のページは結果を作らないので、ないと中身が出ない）。
// 消す SQL は、β の課題・法案についた行（ほかの人の通知・票・立場など）も消す。ステージングに本当の利用者がいない前提で使う（本番には流さない）
import { proposalRequirement } from '../domain/bills';
import { NOTIFICATION_KINDS, targetOf, type NoticeTarget } from '../domain/notifications';
import { searchTexts } from '../domain/search';
import { sessionAt, type Session } from '../domain/session';
import { billOutcome, quorumRequirement, SETTLE_GRACE, type VoteChoice, type VoteCounts } from '../domain/votes';
import { inserts, literal, type Raw, type Table, type Value } from './seed';

/** β の利用者の印。利用者の id・名前・メール、回線のハッシュの頭に付ける */
export const BETA_PREFIX = 'beta-';
export const BETA_USERS = 100;
export const BETA_ISSUES = 50;
const SOLUTIONS_PER_ISSUE = 2;
const BILLS_PER_SESSION = 5;
/** 法案ごとの賛同（発議要件は100人で5人） */
const SUPPORTERS = 8;
/** 1人が票を入れる法案の数（くじの割り当てと同じ3本） */
const VOTES_EACH = 3;
const COMMITTEE = 1;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** 消費者保護の課題のひな形。題名に番号を付けて50件にする（10件ずつ同じひな形） */
const THEMES = [
	{
		title: '定期購入の解約の方法が分かりにくい',
		affected: '通信販売で買い物をする人',
		example: '初回だけのつもりが定期購入になっていて、解約の窓口が電話だけだった',
		solutions: ['広告と申込みの画面に、解約の方法を並べて書かせる', '解約をネットでも受け付けるようにさせる']
	},
	{
		title: '訪問販売で断っても帰ってくれない',
		affected: '一人暮らしの高齢者',
		example: '屋根の点検と言って来た業者が、断っても契約を迫った',
		solutions: ['断った人への勧誘の禁止を分かりやすく示す', '家族が代わりに解約できる期間を設ける']
	},
	{
		title: '解約料が高すぎる',
		affected: '習い事や通信の契約をした人',
		example: '1か月で解約したら、残りの期間の料金を全部請求された',
		solutions: ['解約料の上限を平均的な損害に合わせる', '解約料の計算の方法を契約の前に説明させる']
	},
	{
		title: 'ネット広告の「いまだけ」の表示がずっと出ている',
		affected: 'ネット通販の利用者',
		example: '「残りわずか」の表示が何週間も変わらない',
		solutions: ['期限や在庫の表示の根拠を残させる', '根拠のない期限の表示を不当な表示に入れる']
	},
	{
		title: '無料体験のあとに自動で有料になる',
		affected: 'サブスクリプションを試した人',
		example: '無料の期間が終わった日に、知らせなく1年分の料金が引き落とされた',
		solutions: ['有料になる前に知らせることを義務にする', '無料の期間の終わりの日を申込みの画面に大きく出させる']
	},
	{
		title: 'SNS の副業の勧誘で高い教材を買わされた',
		affected: '学生や若い人',
		example: '「簡単にもうかる」と言われて、50万円の教材を分割で買った',
		solutions: ['もうけの話の勧誘にも解約の期間を設ける', '借金をさせて買わせる勧誘を禁止する']
	},
	{
		title: '電話の勧誘で契約したことになっていた',
		affected: '電話を受けることの多い高齢者',
		example: '話を聞いただけのつもりが、あとで契約書が送られてきた',
		solutions: ['電話の勧誘の契約は書面の同意がないと成り立たないようにする', '録音を残すことを事業者に義務付ける']
	},
	{
		title: '返品の条件が小さな字で書かれている',
		affected: 'ネットで服や靴を買う人',
		example: '返品できないことが、ページのいちばん下に小さく書いてあった',
		solutions: ['返品の条件を申込みのボタンの近くに書かせる', '返品の条件の字の大きさの決まりを作る']
	},
	{
		title: '口コミにサクラが混ざっている',
		affected: '口コミを見て買い物をする人',
		example: '高い評価の口コミの多くが、同じ日に書かれていた',
		solutions: ['お金を払って書かせた口コミに印を付けさせる', 'サクラの口コミを不当な表示として取り締まる']
	},
	{
		title: '契約書の字が小さくて読めない',
		affected: '目の見えにくい人や高齢者',
		example: '大事な条件が8ポイントより小さい字で書かれていた',
		solutions: ['大事な条件は大きな字で書くことを義務にする', '契約の前に大事な条件を口で説明させる']
	}
];

/** 法案が変える条（いま施行されている版にある条）。前の会期の5本、いまの会期の5本の順 */
const BILL_TARGETS = [
	{ law: '412AC0000000061', num: '4', title: '取消しの対象を広げる消費者契約法の改正案' },
	{ law: '351AC0000000057', num: '12', title: '誇大広告の禁止を強める特定商取引法の改正案' },
	{ law: '337AC0000000134', num: '5', title: '期限の表示の根拠を求める景品表示法の改正案' },
	{ law: '412AC0000000061', num: '9', title: '解約料の上限を決める消費者契約法の改正案' },
	{ law: '351AC0000000057', num: '21', title: '電話勧誘の書面を見直す特定商取引法の改正案' },
	{ law: '412AC0000000061', num: '10', title: '不当な条項を増やす消費者契約法の改正案' },
	{ law: '351AC0000000057', num: '35', title: '副業の勧誘を対象にする特定商取引法の改正案' },
	{ law: '337AC0000000134', num: '7', title: '口コミの表示を対象にする景品表示法の改正案' },
	{ law: '412AC0000000061', num: '8', title: '事業者の責任を免れる条項を見直す消費者契約法の改正案' },
	{ law: '351AC0000000057', num: '15_3', title: '定期購入の解約を見直す特定商取引法の改正案' }
];

const STANCES = ['for', 'undecided', 'against'] as const;

/** 作った行の数。betaCountSql の列と同じ名前。sessionParticipants と notifications は入れたあとに本体が作る行で、入れた直後は0 */
export type BetaCounts = {
	users: number;
	issues: number;
	issueSearch: number;
	solutions: number;
	solutionSearch: number;
	issueSupports: number;
	solutionReactions: number;
	bills: number;
	billChanges: number;
	billSupports: number;
	stances: number;
	previousVotes: number;
	currentVotes: number;
	billResults: number;
	actions: number;
	sessionParticipants: number;
	notifications: number;
};

const pad = (n: number) => String(n).padStart(3, '0');
const userId = (i: number) => `${BETA_PREFIX}u${pad(i + 1)}`;
const ipHash = (i: number) => `${BETA_PREFIX}ip${pad(i + 1)}`;
/** a から b のあいだの、割合 f の時刻 */
const between = (a: number, b: number, f: number) => a + Math.floor((b - a) * f);

const issueAuthor = (k: number) => (k * 2) % BETA_USERS;
const issueTitle = (k: number) => `${THEMES[k % THEMES.length].title}（β${pad(k + 1)}）`;
const solutionAuthor = (k: number, s: number) => (k * 2 + 1 + s * 50) % BETA_USERS;
const solutionBody = (k: number, s: number) => `${THEMES[k % THEMES.length].solutions[s]}（β${pad(k + 1)}-${s + 1}）`;

const raw = (sql: string): Raw => ({ sql });
const issueRef = (k: number) => raw(`SELECT id FROM issues WHERE user_id = ${literal(userId(issueAuthor(k)))} AND title = ${literal(issueTitle(k))}`);
const solutionRef = (k: number, s: number) => raw(`SELECT id FROM solutions WHERE user_id = ${literal(userId(solutionAuthor(k, s)))} AND body = ${literal(solutionBody(k, s))}`);

/** いま施行されている現実の版（書く画面の「基にした版」） */
const currentRevision = (law: string) =>
	`SELECT id FROM law_revisions WHERE law_id = ${literal(law)} AND branch = 'real' AND status = 'enforced' ORDER BY seq DESC LIMIT 1`;
/** いま施行されている版で有効な条の列（内部IDか見出し） */
const currentArticle = (law: string, num: string, column: 'p.id' | 'v.caption') =>
	raw(`SELECT ${column} FROM provisions p JOIN provision_versions v ON v.provision_id = p.id
		JOIN law_revisions cur ON cur.id = (${currentRevision(law)})
		WHERE p.law_id = ${literal(law)} AND p.kind = 'article' AND v.num = ${literal(num)}
		AND EXISTS (SELECT 1 FROM law_revisions f WHERE f.id = v.from_revision_id AND f.branch = 'real' AND f.seq <= cur.seq)
		AND NOT EXISTS (SELECT 1 FROM law_revisions t WHERE t.id = v.to_revision_id AND t.seq <= cur.seq)
		LIMIT 1`);

const table = (name: string, columns: string[]): Table => ({ name, columns, rows: [] });

/**
 * now を「いま」としたときの β の規模のデータを入れる SQL（D1 の --file で流せる形）と、作る行の数。
 * 法令（laws・law_revisions・provisions）は取り込み済みの DB に流す
 */
export function betaData(now: number): { statements: string[]; expected: BetaCounts } {
	const current = sessionAt(now, null);
	const previous = sessionAt(current.startsAt - 1, null);
	if (proposalRequirement(BETA_USERS) > SUPPORTERS) throw new Error('賛同の数が発議要件に届きません');

	const users = table('user', ['id', 'name', 'email', 'email_verified', 'created_at', 'updated_at']);
	const issues = table('issues', ['user_id', 'title', 'affected', 'example', 'topic_id', 'created_at']);
	// 検索の行は、引く先の行より後に入れる（副問い合わせが NULL にならないように）。課題と解決策で表を分ける
	const search = {
		issue: { trigram: table('search_trigram', ['kind', 'ref_id', 'text']), bigram: table('search_bigram', ['kind', 'ref_id', 'text']) },
		solution: { trigram: table('search_trigram', ['kind', 'ref_id', 'text']), bigram: table('search_bigram', ['kind', 'ref_id', 'text']) }
	};
	const solutions = table('solutions', ['issue_id', 'user_id', 'body', 'created_at']);
	const issueSupports = table('issue_supports', ['issue_id', 'user_id', 'created_at']);
	const reactions = table('solution_reactions', ['solution_id', 'user_id', 'kind', 'created_at']);
	const bills = table('bills', [
		'user_id',
		'committee_id',
		'kind',
		'status',
		'rev',
		'next_rev',
		'title',
		'affected',
		'side_effects',
		'summary',
		'created_at',
		'updated_at',
		'proposed_at',
		'proposed_rev'
	]);
	const billLaws = table('bill_laws', ['bill_id', 'rev', 'seq', 'action', 'law_id', 'base_revision_id', 'new_title', 'base_if_seq']);
	const billChanges = table('bill_changes', ['bill_id', 'rev', 'law_seq', 'num', 'op', 'provision_id', 'caption', 'body']);
	const billSolutions = table('bill_solutions', ['bill_id', 'rev', 'seq', 'solution_id']);
	const billSupports = table('bill_supports', ['bill_id', 'rev', 'user_id', 'created_at']);
	const stances = table('stances', ['session_key', 'bill_id', 'user_id', 'stance', 'changes', 'updated_at']);
	const votes = table('votes', ['session_key', 'bill_id', 'user_id', 'choice', 'created_at', 'updated_at']);
	const results = table('bill_results', [
		'session_key',
		'bill_id',
		'outcome',
		'yes',
		'no',
		'abstain',
		'ref_yes',
		'ref_no',
		'ref_abstain',
		'participants',
		'quorum',
		'rev',
		'settled_at'
	]);
	const actions = table('actions', ['kind', 'user_id', 'ip_hash', 'target_id', 'created_at']);
	const act = (kind: string, i: number, target: Value | Raw, at: number) => actions.rows.push([kind, userId(i), ipHash(i), target, at]);
	const index = (kind: 'issue' | 'solution', ref: Raw, source: string) => {
		const texts = searchTexts(source);
		if (!texts) return;
		search[kind].trigram.rows.push([kind, ref, texts.trigram]);
		search[kind].bigram.rows.push([kind, ref, texts.bigram]);
	};

	// 利用者：前の会期の45日前から10分おきに登録（投票資格の「会期の始まりより前に登録」を満たす）
	for (let i = 0; i < BETA_USERS; i++) {
		const at = previous.startsAt - 45 * DAY + i * 10 * MINUTE;
		users.rows.push([userId(i), `${BETA_PREFIX}参加者${pad(i + 1)}`, `${userId(i)}@users.invalid`, 0, at, at]);
	}

	// 課題：最初の10件は前の会期の前の週、残りは前の会期の始まりから「いま」までに散らす
	const issueAt: number[] = [];
	for (let k = 0; k < BETA_ISSUES; k++) {
		const at = k < 10 ? previous.startsAt - 7 * DAY + k * 12 * HOUR : between(previous.startsAt, now, (k - 10 + 0.5) / (BETA_ISSUES - 10));
		issueAt.push(at);
		const theme = THEMES[k % THEMES.length];
		issues.rows.push([userId(issueAuthor(k)), issueTitle(k), theme.affected, theme.example, null, at]);
		// 題名・困っている人・具体例を別の行に（src/lib/server/search.ts の indexTexts と同じ）
		for (const source of [issueTitle(k), theme.affected, theme.example]) index('issue', issueRef(k), source);
		act('issue_post', issueAuthor(k), issueRef(k), at);
	}

	// 解決策：課題ごとに2件。課題のあと、「いま」までに
	const solutionAt: number[][] = [];
	for (let k = 0; k < BETA_ISSUES; k++) {
		solutionAt.push([]);
		for (let s = 0; s < SOLUTIONS_PER_ISSUE; s++) {
			const at = between(issueAt[k], Math.min(now, issueAt[k] + 2 * DAY), (s + 1) / (SOLUTIONS_PER_ISSUE + 1));
			solutionAt[k].push(at);
			solutions.rows.push([issueRef(k), userId(solutionAuthor(k, s)), solutionBody(k, s), at]);
			index('solution', solutionRef(k, s), solutionBody(k, s));
			act('solution_post', solutionAuthor(k, s), solutionRef(k, s), at);
		}
	}

	// 「わかる」：1人3件。1件目は前の会期の前（今月の参加者と投票資格に数える行動）、あとの2件は前の会期からいままでの課題
	for (let i = 0; i < BETA_USERS; i++) {
		const picked = new Set<number>();
		const pick = (k: number, span: number, base: number) => {
			let n = k;
			while (picked.has(n) || issueAuthor(n) === i) n = base + ((n - base + 1) % span);
			picked.add(n);
			return n;
		};
		const early = pick(i % 10, 10, 0);
		const late = [0, 1].map((j) => pick(10 + ((7 * i + 13 * j) % 40), 40, 10));
		const f = (i + 1) / (BETA_USERS + 1);
		for (const [k, until] of [
			[early, previous.startsAt],
			...late.map((k) => [k, now] as const)
		] as const) {
			const at = between(issueAt[k], until, f);
			issueSupports.rows.push([issueRef(k), userId(i), at]);
			act('support_add', i, issueRef(k), at);
		}
		// 解決策の「わかる」：1人1件（自分の解決策は選ばない）
		let n = (i * 3 + 1) % (BETA_ISSUES * SOLUTIONS_PER_ISSUE);
		while (solutionAuthor(Math.floor(n / 2), n % 2) === i) n = (n + 1) % (BETA_ISSUES * SOLUTIONS_PER_ISSUE);
		const [k, s] = [Math.floor(n / 2), n % 2];
		const at = between(solutionAt[k][s], now, f);
		reactions.rows.push([solutionRef(k, s), userId(i), 'support', at]);
		act('reaction_add', i, solutionRef(k, s), at);
	}

	// 法案：前の会期に5本、いまの会期に5本。どれも発議の締切（3週目）より前に発議し、その会期に付託される
	const expectedVotes = { previous: 0, current: 0 };
	for (let b = 0; b < BILLS_PER_SESSION * 2; b++) {
		const isPrevious = b < BILLS_PER_SESSION;
		const session: Session = isPrevious ? previous : current;
		const j = b % BILLS_PER_SESSION;
		const proposedAt = isPrevious
			? previous.startsAt + 2 * DAY + j * 6 * HOUR
			: between(current.startsAt, Math.min(now, current.deliberationAt - 1), (j + 1) / (BILLS_PER_SESSION + 1));
		const createdAt = proposedAt - DAY;
		// 元にする解決策：前の会期の前に書かれた課題（最初の10件）の1件目
		const sourceIssue = b;
		const author = solutionAuthor(sourceIssue, 0);
		const target = BILL_TARGETS[b];
		const title = `${target.title}（β${b + 1}）`;
		const ref = raw(`SELECT id FROM bills WHERE user_id = ${literal(userId(author))} AND title = ${literal(title)}`);
		bills.rows.push([
			userId(author),
			COMMITTEE,
			'amend',
			'proposed',
			1,
			2,
			title,
			THEMES[sourceIssue % THEMES.length].affected,
			'事業者の手間が増える',
			`${target.title}\n困っている人を減らす\n事業者の手間は少し増える`,
			createdAt,
			proposedAt,
			proposedAt,
			1
		]);
		billLaws.rows.push([ref, 1, 0, 'amend', target.law, raw(currentRevision(target.law)), null, 0]);
		const body = JSON.stringify([{ num: '1', text: `${target.title}のための新しい条文（β${b + 1}）。事業者は、消費者に分かりやすく説明しなければならない。`, items: [] }]);
		billChanges.rows.push([ref, 1, 0, target.num, 'amend', currentArticle(target.law, target.num, 'p.id'), currentArticle(target.law, target.num, 'v.caption'), body]);
		billSolutions.rows.push([ref, 1, 0, solutionRef(sourceIssue, 0)]);
		act('bill_draft', author, ref, createdAt);

		const supporters = new Set<number>();
		for (let s = 0; supporters.size < SUPPORTERS; s++) {
			const i = (40 + b * 6 + s) % BETA_USERS;
			if (i === author) continue;
			supporters.add(i);
			const at = between(createdAt, proposedAt, supporters.size / (SUPPORTERS + 1));
			billSupports.rows.push([ref, 1, userId(i), at]);
			act('bill_support_add', i, ref, at);
		}
		act('bill_propose', author, ref, proposedAt);

		// 立場と票：法案を出した人と賛同した人のほかで、法案の番号が自分の3本に入る人（1人3本）。
		// 賛成寄りは賛成、未定は反対か棄権、反対寄りは反対 → どれも否決
		const counts: VoteCounts = { yes: 0, no: 0, abstain: 0 };
		const voteFrom = isPrevious ? previous.voteAt : current.voteAt;
		const voteUntil = isPrevious ? previous.endsAt - 1 : now;
		const stanceUntil = isPrevious ? previous.voteAt : now;
		for (let i = 0; i < BETA_USERS; i++) {
			if (i === author || supporters.has(i)) continue;
			if (!Array.from({ length: VOTES_EACH }, (_, d) => (i + d) % BILLS_PER_SESSION).includes(j)) continue;
			const f = (i + 1) / (BETA_USERS + 1);
			const stance = STANCES[i % 3];
			stances.rows.push([session.key, ref, userId(i), stance, 0, between(proposedAt, stanceUntil, f)]);
			// いまの会期の票は、採決の期間に入っていれば（入る前は票がない）
			if (!isPrevious && now < current.voteAt) continue;
			const choice: VoteChoice = stance === 'for' ? 'yes' : stance === 'against' ? 'no' : i % 2 ? 'no' : 'abstain';
			const at = between(voteFrom, voteUntil, f);
			votes.rows.push([session.key, ref, userId(i), choice, at, at]);
			act('vote_cast', i, ref, at);
			counts[choice] += 1;
			expectedVotes[isPrevious ? 'previous' : 'current'] += 1;
		}
		if (isPrevious) {
			// 前の会期の結果。投票資格（前の会期の前の「わかる」）があり、割り当ての行がないので、どの票も数えた票
			const quorum = quorumRequirement(BETA_USERS);
			const outcome = billOutcome(counts, quorum);
			if (outcome !== 'rejected') throw new Error(`前の会期の法案が否決になりません（${outcome}）`);
			const settledAt = Math.min(previous.endsAt + SETTLE_GRACE + MINUTE, now);
			results.rows.push([previous.key, ref, outcome, counts.yes, counts.no, counts.abstain, 0, 0, 0, BETA_USERS, quorum, 1, settledAt]);
		} else if (counts.yes + counts.no + counts.abstain > 0 && counts.yes >= counts.no) {
			throw new Error('いまの会期の法案が否決になりません');
		}
	}

	// 外部キーを満たす順
	const tables = [
		users,
		issues,
		search.issue.trigram,
		search.issue.bigram,
		solutions,
		search.solution.trigram,
		search.solution.bigram,
		issueSupports,
		reactions,
		bills,
		billLaws,
		billChanges,
		billSolutions,
		billSupports,
		stances,
		votes,
		results,
		actions
	];
	return {
		statements: tables.flatMap(inserts),
		expected: {
			users: users.rows.length,
			issues: issues.rows.length,
			issueSearch: search.issue.trigram.rows.length,
			solutions: solutions.rows.length,
			solutionSearch: search.solution.trigram.rows.length,
			issueSupports: issueSupports.rows.length,
			solutionReactions: reactions.rows.length,
			bills: bills.rows.length,
			billChanges: billChanges.rows.length,
			billSupports: billSupports.rows.length,
			stances: stances.rows.length,
			previousVotes: expectedVotes.previous,
			currentVotes: expectedVotes.current,
			billResults: results.rows.length,
			actions: actions.rows.length,
			sessionParticipants: 0,
			notifications: 0
		}
	};
}

const BETA = `LIKE '${BETA_PREFIX}%'`;
const BETA_ISSUE_IDS = `SELECT id FROM issues WHERE user_id ${BETA}`;
const BETA_SOLUTION_IDS = `SELECT id FROM solutions WHERE user_id ${BETA} OR issue_id IN (${BETA_ISSUE_IDS})`;
const BETA_BILL_IDS = `SELECT id FROM bills WHERE user_id ${BETA}`;

/** 通知の対象（target_id）の種類ごとの kind の並び（SQL の IN の中身） */
const kindsOf = (target: NoticeTarget) =>
	NOTIFICATION_KINDS.filter((k) => targetOf(k) === target)
		.map((k) => literal(k))
		.join(', ');
/** β の利用者への通知と、β の法案・課題・解決策を対象にした通知 */
const BETA_NOTIFICATIONS = `user_id ${BETA}
	OR (kind IN (${kindsOf('bill')}) AND target_id IN (${BETA_BILL_IDS}))
	OR (kind IN (${kindsOf('issue')}) AND target_id IN (${BETA_ISSUE_IDS}))
	OR (kind IN (${kindsOf('solution')}) AND target_id IN (${BETA_SOLUTION_IDS}))`;
/** データを入れたあと（since 以後）に固定された今月の参加者の数（β の利用者を数えている）。消すと、次に読まれたときに数え直す */
const fixedSince = (since: number) => `fixed_at >= ${Math.floor(since)}`;

/**
 * β の行の数を1行で返す SELECT（列は BetaCounts と同じ）。since はデータを作った時刻（betaData の now）。
 * votes は、結果の行のある会期（前の会期）とそれ以外に分ける
 */
export const betaCountSql = (since: number) => `SELECT
	(SELECT count(*) FROM user WHERE id ${BETA}) AS users,
	(SELECT count(*) FROM issues WHERE user_id ${BETA}) AS issues,
	(SELECT count(*) FROM search_trigram WHERE kind = 'issue' AND ref_id IN (${BETA_ISSUE_IDS})) AS issueSearch,
	(SELECT count(*) FROM solutions WHERE user_id ${BETA}) AS solutions,
	(SELECT count(*) FROM search_trigram WHERE kind = 'solution' AND ref_id IN (${BETA_SOLUTION_IDS})) AS solutionSearch,
	(SELECT count(*) FROM issue_supports WHERE user_id ${BETA}) AS issueSupports,
	(SELECT count(*) FROM solution_reactions WHERE user_id ${BETA}) AS solutionReactions,
	(SELECT count(*) FROM bills WHERE user_id ${BETA} AND status = 'proposed') AS bills,
	(SELECT count(*) FROM bill_changes WHERE bill_id IN (${BETA_BILL_IDS}) AND provision_id IS NOT NULL) AS billChanges,
	(SELECT count(*) FROM bill_supports WHERE bill_id IN (${BETA_BILL_IDS})) AS billSupports,
	(SELECT count(*) FROM stances WHERE bill_id IN (${BETA_BILL_IDS})) AS stances,
	(SELECT count(*) FROM votes v WHERE v.bill_id IN (${BETA_BILL_IDS}) AND EXISTS (SELECT 1 FROM bill_results r WHERE r.bill_id = v.bill_id AND r.session_key = v.session_key)) AS previousVotes,
	(SELECT count(*) FROM votes v WHERE v.bill_id IN (${BETA_BILL_IDS}) AND NOT EXISTS (SELECT 1 FROM bill_results r WHERE r.bill_id = v.bill_id AND r.session_key = v.session_key)) AS currentVotes,
	(SELECT count(*) FROM bill_results WHERE bill_id IN (${BETA_BILL_IDS})) AS billResults,
	(SELECT count(*) FROM actions WHERE user_id ${BETA}) AS actions,
	(SELECT count(*) FROM session_participants WHERE ${fixedSince(since)}) AS sessionParticipants,
	(SELECT count(*) FROM notifications WHERE ${BETA_NOTIFICATIONS}) AS notifications`;

/**
 * β の行を消す SQL（外部キーを満たす順）。since はデータを作った時刻。読んだときに本体が作る行（立場別の分布、確認、通知、今月の参加者の数）も消す。
 * β の課題・法案についた行は、だれが書いたものでも消す（ステージングに本当の利用者がいない前提）。
 * 法案は可決にしないので IF世界の行はできない。もしできていたら、bill_laws を消すところで外部キーの違反で止まる（手で確かめる）
 */
export const betaDeleteStatements = (since: number) =>
	[
		`DELETE FROM search_trigram WHERE kind = 'issue' AND ref_id IN (${BETA_ISSUE_IDS})`,
		`DELETE FROM search_bigram WHERE kind = 'issue' AND ref_id IN (${BETA_ISSUE_IDS})`,
		`DELETE FROM search_trigram WHERE kind = 'solution' AND ref_id IN (${BETA_SOLUTION_IDS})`,
		`DELETE FROM search_bigram WHERE kind = 'solution' AND ref_id IN (${BETA_SOLUTION_IDS})`,
		`DELETE FROM law_refs WHERE (kind = 'issue' AND ref_id IN (${BETA_ISSUE_IDS})) OR (kind = 'solution' AND ref_id IN (${BETA_SOLUTION_IDS}))`,
		`DELETE FROM notifications WHERE ${BETA_NOTIFICATIONS}`,
		`DELETE FROM session_participants WHERE ${fixedSince(since)}`,
		`DELETE FROM stance_stats WHERE bill_id IN (${BETA_BILL_IDS})`,
		`DELETE FROM vote_reviews WHERE bill_id IN (${BETA_BILL_IDS})`,
		`DELETE FROM bill_results WHERE bill_id IN (${BETA_BILL_IDS})`,
		`DELETE FROM votes WHERE bill_id IN (${BETA_BILL_IDS}) OR user_id ${BETA}`,
		`DELETE FROM vote_assignments WHERE bill_id IN (${BETA_BILL_IDS}) OR user_id ${BETA}`,
		`DELETE FROM stances WHERE bill_id IN (${BETA_BILL_IDS}) OR user_id ${BETA}`,
		`DELETE FROM stance_log WHERE bill_id IN (${BETA_BILL_IDS}) OR user_id ${BETA}`,
		`DELETE FROM bill_supports WHERE bill_id IN (${BETA_BILL_IDS}) OR user_id ${BETA}`,
		`DELETE FROM bill_solutions WHERE bill_id IN (${BETA_BILL_IDS})`,
		`DELETE FROM bill_changes WHERE bill_id IN (${BETA_BILL_IDS})`,
		`DELETE FROM bill_laws WHERE bill_id IN (${BETA_BILL_IDS})`,
		`DELETE FROM bills WHERE user_id ${BETA}`,
		`DELETE FROM solution_reactions WHERE solution_id IN (${BETA_SOLUTION_IDS}) OR user_id ${BETA}`,
		`DELETE FROM solutions WHERE user_id ${BETA} OR issue_id IN (${BETA_ISSUE_IDS})`,
		`DELETE FROM issue_supports WHERE issue_id IN (${BETA_ISSUE_IDS}) OR user_id ${BETA}`,
		`DELETE FROM issues WHERE user_id ${BETA}`,
		`DELETE FROM actions WHERE user_id ${BETA}`,
		`DELETE FROM user WHERE id ${BETA}`
	].map((s) => `${s};`);
