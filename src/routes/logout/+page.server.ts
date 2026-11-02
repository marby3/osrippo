import { redirect } from '@sveltejs/kit';
import type { Actions } from './$types';

// ログアウトは POST だけ（GET では切らない）
export const actions: Actions = {
	default: async ({ locals, request }) => {
		await locals.auth.api.signOut({ headers: request.headers });
		redirect(303, '/');
	}
};
