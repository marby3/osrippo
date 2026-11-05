// 読んだ記録の画面の側（Issue #67。設計書 docs/spec/67.md 決めたこと4）。
// 投稿が3秒続けて画面に出たら読んだことにし、番号をためて送る
import type { Action } from 'svelte/action';

const DWELL = 3000;
const FLUSH = 1000;
const CHUNK = 50;
/** 高い要素は比率が上がらないので、途中の比率でも判定する */
const THRESHOLDS = [0, 0.25, 0.5, 0.75, 1];

type Watched = { id: number; inView: boolean; timer: ReturnType<typeof setTimeout> | null };

export type ReadTracker = ReturnType<typeof createReadTracker>;

export function createReadTracker(send: (ids: number[]) => void) {
	const sent = new Set<number>();
	const watched = new Map<Element, Watched>();
	let queue: number[] = [];
	let flushTimer: ReturnType<typeof setTimeout> | null = null;
	let observer: IntersectionObserver | null = null;

	function flush() {
		if (flushTimer !== null) clearTimeout(flushTimer);
		flushTimer = null;
		while (queue.length > 0) send(queue.splice(0, CHUNK));
	}

	/** 読んだことにする（開いたときはすぐに） */
	function mark(id: number) {
		if (sent.has(id)) return;
		sent.add(id);
		queue.push(id);
		flushTimer ??= setTimeout(flush, FLUSH);
	}

	/** 画面に出ていてタブが見えているあいだだけ数える。外れたら数え直す */
	function sync(el: Element, w: Watched) {
		if (w.inView && document.visibilityState === 'visible') {
			w.timer ??= setTimeout(() => {
				w.timer = null;
				mark(w.id);
				unwatch(el);
			}, DWELL);
		} else if (w.timer !== null) {
			clearTimeout(w.timer);
			w.timer = null;
		}
	}

	function watch(el: Element, id: number) {
		if (sent.has(id)) return;
		observer ??= new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					const w = watched.get(entry.target);
					if (!w) continue;
					const half = (entry.rootBounds?.height ?? window.innerHeight) / 2;
					w.inView = entry.isIntersecting && (entry.intersectionRatio >= 0.5 || entry.intersectionRect.height >= half);
					sync(entry.target, w);
				}
			},
			{ threshold: THRESHOLDS }
		);
		watched.set(el, { id, inView: false, timer: null });
		observer.observe(el);
	}

	function unwatch(el: Element) {
		const w = watched.get(el);
		if (!w) return;
		if (w.timer !== null) clearTimeout(w.timer);
		watched.delete(el);
		observer?.unobserve(el);
	}

	/** 画面に置いたときに呼ぶ。返す関数で片付ける（ページを離れるときに、たまっている分を送る） */
	function start() {
		const onVisibility = () => {
			for (const [el, w] of watched) sync(el, w);
		};
		document.addEventListener('visibilitychange', onVisibility);
		window.addEventListener('pagehide', flush);
		return () => {
			document.removeEventListener('visibilitychange', onVisibility);
			window.removeEventListener('pagehide', flush);
			for (const el of [...watched.keys()]) unwatch(el);
			observer?.disconnect();
			observer = null;
			flush();
		};
	}

	return { mark, watch, unwatch, start };
}

type Target = { tracker: ReadTracker; id: number } | null;

/** 要素を見張る。target が null なら見張らない（ログインしていない、自分の投稿など） */
export const readWhenSeen: Action<Element, Target> = (el, target) => {
	let current = target;
	current?.tracker.watch(el, current.id);
	return {
		update(next) {
			if (next?.id === current?.id && next?.tracker === current?.tracker) return;
			current?.tracker.unwatch(el);
			current = next;
			current?.tracker.watch(el, current.id);
		},
		destroy() {
			current?.tracker.unwatch(el);
		}
	};
};
