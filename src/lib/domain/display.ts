// 表示の設定（Issue #129）：文字の大きさとふりがな。ブラウザの Cookie に覚える（決めることD）。DB にも画面にも触れない

export const TEXT_SIZES = ['m', 'l', 'xl'] as const;
export type TextSize = (typeof TEXT_SIZES)[number];
export type Display = { size: TextSize; ruby: boolean };

export const DISPLAY_COOKIES = { size: 'text_size', ruby: 'ruby' } as const;
export const DEFAULT_DISPLAY: Display = { size: 'm', ruby: true };

/** Cookie の値から。知らない値は既定にする */
export function parseDisplay(get: (name: string) => string | undefined): Display {
	const size = get(DISPLAY_COOKIES.size);
	return {
		size: (TEXT_SIZES as readonly string[]).includes(size ?? '') ? (size as TextSize) : DEFAULT_DISPLAY.size,
		ruby: get(DISPLAY_COOKIES.ruby) !== 'off'
	};
}

/** html に付ける属性（サーバーで描くときに入れるので、開いた直後から設定のとおり。基準5） */
export const displayAttributes = (d: Display) => `data-text-size="${d.size}" data-ruby="${d.ruby ? 'on' : 'off'}"`;
