// 今日の条文（Issue #128）。委員会の対象法令の短い条から、日本時間の日付で1日1本を選ぶ
import { articleLabel, compareNum, fullYears } from '../domain/law';
import { articlesOfRevision, committeeLawList, currentRevision, enactmentRevision, lastAmendedDates, type Db } from './law';

/** 候補にする本文の長さの上限（カードに収まる長さ） */
const MAX_LENGTH = 120;

export type TodayArticle = { lawId: string; lawTitle: string; num: string; label: string; text: string; lastAmended: string | null; enacted: string | null };

/**
 * 候補：いまの版で、項が1つで号がなく、本文が120字以内で、最後の改正（か制定）から1年以上たった条。「削除」は入れない。
 * 並びは法令の番号の順、その中は条の順。改正の日は法令のページ（lawPage）と同じ求め方
 */
export async function todayCandidates(db: Db, today: string): Promise<TodayArticle[]> {
	const out: TodayArticle[] = [];
	for (const law of await committeeLawList(db)) {
		const current = await currentRevision(db, law.id);
		if (!current) continue;
		const amended = await lastAmendedDates(db, law.id);
		const enactedOn = (await enactmentRevision(db, law.id))?.date ?? null;
		const articles = (await articlesOfRevision(db, current.id)).sort((a, b) => compareNum(a.num, b.num));
		for (const a of articles) {
			const [p] = a.paragraphs;
			if (a.paragraphs.length !== 1 || p.items.length || p.text.length > MAX_LENGTH || p.text === '削除') continue;
			const lastAmended = amended.get(a.id) ?? null;
			const enacted = lastAmended ? null : enactedOn;
			const changed = lastAmended ?? enacted;
			if (changed && fullYears(changed, today) < 1) continue;
			out.push({ lawId: law.id, lawTitle: law.title, num: a.num, label: articleLabel(a.num), text: p.text, lastAmended, enacted });
		}
	}
	return out;
}

/** 1970-01-01 から数えた日の番号（today は YYYY-MM-DD） */
const dayNumber = (today: string) => Math.floor(Date.parse(`${today}T00:00:00Z`) / 86_400_000);

/** その日の条。日が1つ進むと候補の並びで次の条になる。候補がなければ null */
export async function todayArticle(db: Db, today: string): Promise<TodayArticle | null> {
	const list = await todayCandidates(db, today);
	return list.length ? list[dayNumber(today) % list.length] : null;
}

let cached: { today: string; article: TodayArticle | null } | null = null;

/** ホームから呼ぶ。同じ日は Workers の中で覚えておき、条を読み直さない（決めることC） */
export async function cachedTodayArticle(db: Db, today: string): Promise<TodayArticle | null> {
	if (cached?.today !== today) cached = { today, article: await todayArticle(db, today) };
	return cached.article;
}
