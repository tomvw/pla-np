import { writable, derived } from 'svelte/store';

export const sessions = writable([]);
export const activeIndex = writable(0);

export const activeSession = derived(
	[sessions, activeIndex],
	([$sessions, $activeIndex]) => {
		const s = $sessions[$activeIndex];
		if (!s) return null;
		return {
			...s,
			localOffset: s.localOffset ?? s.offset
		};
	}
)

export const tick = writable(0);(
	[sessions, activeIndex],
	([$sessions, $activeIndex]) =>
		$sessions[$activeIndex] ?? null
);
