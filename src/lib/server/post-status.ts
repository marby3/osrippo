// 書く文と副問い合わせで使う、投稿の状態の並び（設計書 docs/spec/80.md）。Cron の入口からも読むので、cloudflare:workers に頼らない
import { sql } from 'drizzle-orm';
import { POST_HIDDEN, POST_SHOWN } from '../domain/reports';

const list = (values: readonly string[]) => sql.raw(values.map((s) => `'${s}'`).join(', '));
export const POST_SHOWN_SQL = list(POST_SHOWN);
export const POST_HIDDEN_SQL = list(POST_HIDDEN);
