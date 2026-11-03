import { requireUser } from '#lib/server/require-user.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = (event) => {
	const user = requireUser(event);
	return { name: user.name };
};
