// 修正案の決まり（Issue #68。設計書 docs/spec/68.md 決めたこと1〜3・7・11）。DB にも画面にも触れない
import { BILL_MAX, checkChanges, parseArticleBody, proposalRequirement, type BaseArticle, type BillChange, type BillKind, type BillProgress, type BodyError, type ChangeError } from './bills';
import { checkText, type IssueError } from './issues';
import { DAY } from './limits';
import { articleBodyText, type Paragraph } from './law';
import type { BillOutcome } from './votes';

export const AMENDMENT_STATUSES = ['open', 'accepted', 'passed', 'failed', 'superseded', 'lapsed', 'unvoted'] as const;
export type AmendmentStatus = (typeof AMENDMENT_STATUSES)[number];
export const AMENDMENT_PAGE_SIZE = 20;
export const AMENDMENT_REASON_MAX = 400;

/** 出す・更新・賛同の時期：3週目 */
export const amendmentOpen = (progress: BillProgress) => progress === 'deliberation';
/** 票の時期：4週目 */
export const amendmentVoteOpen = (progress: BillProgress) => progress === 'vote';
/** 取り込める時期：3週目で、採決の24時間前まで（締切の直前に取り込んで、ほかの修正案を止められないように） */
export const acceptOpen = (progress: BillProgress, now: number, voteAt: number) => progress === 'deliberation' && now < voteAt - DAY;

/** 本案より先に採決するのに要る賛同：発議要件の半分の切り上げ */
export const priorVoteRequirement = (participants: number) => Math.ceil(proposalRequirement(participants) / 2);

/** 変えられる条があるか（廃止の法令の条は変えられない） */
export const hasAmendableLaw = (laws: { action: BillKind }[]) => laws.some((l) => l.action !== 'repeal');

export type AmendmentBodyError = BodyError | 'unchanged' | 'sameAsBase';

/** 変更後の条文。いまの本案と同じ本文と、基にした条文へ戻す本文は断る（変更をやめる修正案は入れない） */
export function validateAmendmentBody(
	raw: string,
	article: { current: Paragraph[]; base: Paragraph[] | null }
): { ok: true; paragraphs: Paragraph[] } | { ok: false; error: AmendmentBodyError; line?: number } {
	const parsed = parseArticleBody(raw);
	if (!parsed.ok) return { ok: false, error: parsed.error, line: parsed.line };
	const text = articleBodyText(parsed.paragraphs);
	if (text === articleBodyText(article.current)) return { ok: false, error: 'unchanged' };
	if (article.base && text === articleBodyText(article.base)) return { ok: false, error: 'sameAsBase' };
	return { ok: true, paragraphs: parsed.paragraphs };
}

/** 修正案を当てた本案の決まり（制定の第1条のひな形など）と、変える条の数の上限。下書きで断られる本文を、修正案で入れられないように */
export function checkAmendedLaw(action: BillKind, base: BaseArticle[] | null, changes: BillChange[], totalChanges: number): ChangeError | 'changeCount' | null {
	if (totalChanges > BILL_MAX.changes) return 'changeCount';
	const checked = checkChanges(action, base, changes);
	return checked.ok ? null : checked.errors[0].error;
}

/** 本案より先に採決する修正案か。票を入れる文（castAmendmentVote）も同じ条件を SQL で確かめる */
export const inPriorVote = (a: { status: AmendmentStatus; baseRev: number }, supports: number, billRev: number, required: number) => a.status === 'open' && a.baseRev === billRev && supports >= required;

/** 理由：任意で400字まで。改行可 */
export function validateAmendmentReason(raw: string | null): { ok: true; reason: string | null } | { ok: false; error: IssueError } {
	const [reason, error] = checkText(raw, AMENDMENT_REASON_MAX, true);
	if (error === 'required') return { ok: true, reason: null };
	return error ? { ok: false, error } : { ok: true, reason };
}

/** 「変える条」の値（<law_seq>:<num>）。形が違えば null */
export function parseArticleKey(raw: string): { lawSeq: number; num: string } | null {
	const m = /^([0-4]):(\d+(?:_\d+)*)$/.exec(raw);
	return m ? { lawSeq: Number(m[1]), num: m[2] } : null;
}
export const articleKey = (lawSeq: number, num: string) => `${lawSeq}:${num}`;

/** 本案の法令に修正案を当てる。条があれば本文だけを置きかえ（見出しと op はそのまま）、なければ変更を足す */
export function applyAmendments<L extends { changes: BillChange[] }>(
	laws: L[],
	amendments: { lawSeq: number; num: string; provisionId: number | null; caption: string | null; paragraphs: Paragraph[] }[]
): L[] {
	return laws.map((law, seq) => {
		const changes = [...law.changes];
		for (const a of amendments.filter((x) => x.lawSeq === seq)) {
			const i = changes.findIndex((c) => c.num === a.num);
			if (i >= 0) changes[i] = { ...changes[i], paragraphs: a.paragraphs };
			else changes.push({ op: 'amend', num: a.num, provisionId: a.provisionId, caption: a.caption, paragraphs: a.paragraphs });
		}
		return { ...law, changes };
	});
}

/**
 * 締切のあとの状態。古い順に渡す。可決した修正案のうち、同じ条がまだ採られていないものを採る（先に出したほうを採る）。
 * taken はすでに採った修正案の条（途中で失敗してやり直したとき）
 */
export function adoptedAmendments(
	results: { id: number; lawSeq: number; num: string; outcome: BillOutcome }[],
	taken: { lawSeq: number; num: string }[]
): Map<number, 'passed' | 'failed' | 'superseded' | 'lapsed'> {
	const adopted = new Set(taken.map((t) => articleKey(t.lawSeq, t.num)));
	return new Map(
		results.map((r) => {
			if (r.outcome === 'rejected') return [r.id, 'failed'];
			if (r.outcome === 'lapsed') return [r.id, 'lapsed'];
			const key = articleKey(r.lawSeq, r.num);
			if (adopted.has(key)) return [r.id, 'superseded'];
			adopted.add(key);
			return [r.id, 'passed'];
		})
	);
}
