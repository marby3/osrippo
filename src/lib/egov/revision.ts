// e-Gov の版の行の形と、版の状態の対応（seed と同期で共有する）。Worker からも届くので、e-Gov を呼ぶコードはここに置かない（client.ts）

export type EgovRevision = {
	law_revision_id: string;
	law_title: string;
	law_title_kana: string | null;
	amendment_enforcement_date: string;
	amendment_law_title: string | null;
	amendment_law_num: string | null;
	amendment_promulgate_date: string | null;
	current_revision_status: string;
};

const REVISION_STATUS = {
	CurrentEnforced: 'enforced',
	PreviousEnforced: 'enforced',
	UnEnforced: 'scheduled'
} as const;

/** e-Gov の版の状態を DB の状態にする。知らない状態は undefined（constructor などの値を通さない） */
export function revisionStatus(value: unknown): 'enforced' | 'scheduled' | undefined {
	return typeof value === 'string' && Object.hasOwn(REVISION_STATUS, value) ? REVISION_STATUS[value as keyof typeof REVISION_STATUS] : undefined;
}
