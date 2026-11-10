// Worker の入口の fetch（Issue #156）。SvelteKit は末尾のスラッシュの 308 や、hooks の中で投げたときのエラーのページを
// hooks.handle の外で返すので、ステージングの X-Robots-Tag はここで付ける。Vite を通らず wrangler が束ねるので、#lib に頼らない
import { withNoindex } from '../lib/server/robots';

type Fetch = (request: Request, env: Cloudflare.Env, ctx: ExecutionContext) => Promise<Response>;

export function withNoindexFetch(fetch: Fetch): Fetch {
	return async (request, env, ctx) => withNoindex(await fetch(request, env, ctx), env.NOINDEX);
}
