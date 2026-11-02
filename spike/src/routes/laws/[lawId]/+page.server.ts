import { env } from 'cloudflare:workers';
import { error } from '@sveltejs/kit';
import { diffLaw, type ProvisionRow, type UnitRow } from '#lib/law/diff.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, url }) => {
	const db = env.DB;
	const revs = (
		await db
			.prepare('SELECT revision_id, title, enforcement_date FROM law_revisions WHERE law_id = ? ORDER BY enforcement_date, revision_id')
			.bind(params.lawId)
			.all<{ revision_id: string; title: string; enforcement_date: string }>()
	).results;
	if (!revs.length) error(404, '法令が見つかりません');
	const from = url.searchParams.get('from') ?? revs[Math.max(0, revs.length - 2)].revision_id;
	const to = url.searchParams.get('to') ?? revs[revs.length - 1].revision_id;
	const load = async (r: string) => {
		const [p, u] = await db.batch([
			db.prepare('SELECT provision_id, ord, key, kind, title, caption, deleted FROM provision_versions WHERE revision_id = ? ORDER BY ord').bind(r),
			db.prepare('SELECT provision_id, unit_id, ord, path, label, text FROM unit_versions WHERE revision_id = ? ORDER BY provision_id, ord').bind(r)
		]);
		return { provisions: p.results as ProvisionRow[], units: u.results as UnitRow[] };
	};
	const [a, b] = await Promise.all([load(from), load(to)]);
	const all = url.searchParams.has('all');
	const diffs = diffLaw(a, b).filter((d) => all || d.status !== 'same');
	return { title: revs[0].title, lawId: params.lawId, revs, from, to, all, diffs };
};
