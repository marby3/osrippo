// 法律の別名（Issue #164。決めたことは Issue #198 の「#164」の節）。運営が手で書く表で、DB にも画面にも触れない。
// 英数字の別名は URL（/hourei/tokushoho）に使い、本来の URL（/hourei/351AC0000000057）へ 301 で送る。
// 日本語の通称は、本文の「特商法9条」を条へのリンクにするとき（#165）に使う。e-Gov の略称（readable_laws.abbrevs）とは別に持つ

export type LawAlias = {
	/** e-Gov の law_id */
	lawId: string;
	/** URL に使う英数字の別名（小文字の英字と数字だけ） */
	alias: string;
	/** 日本語の通称 */
	nicknames: readonly string[];
};

export const LAW_ALIASES: readonly LawAlias[] = [
	{ lawId: '351AC0000000057', alias: 'tokushoho', nicknames: ['特商法'] },
	{ lawId: '412AC0000000061', alias: 'shohishakeiyaku', nicknames: ['消契法'] },
	{ lawId: '337AC0000000134', alias: 'keihyoho', nicknames: ['景表法'] }
];

/** 英数字の別名 → 法令ID。表にない別名は undefined（大文字・小文字は区別する） */
export function lawIdOfAlias(alias: string): string | undefined {
	return LAW_ALIASES.find((a) => a.alias === alias)?.lawId;
}

/** 法令ID → 英数字の別名。別名のない法律は undefined */
export function aliasOfLaw(lawId: string): string | undefined {
	return LAW_ALIASES.find((a) => a.lawId === lawId)?.alias;
}
