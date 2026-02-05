import { sessions, activeIndex } from './store';

const PLEX_URL = 'http://plex.ichaival:32400';
const TOKEN = 'zixc8b5naHGZxVc6Mk5G';

let rotationTimer;
let progressTimer;

export async function fetchNowPlaying() {
	const res = await fetch(`${PLEX_URL}/status/sessions?X-Plex-Token=${TOKEN}`);
	const xml = await res.text();

	const doc = new DOMParser().parseFromString(xml, 'application/xml');

	const tracks = [...doc.querySelectorAll('Track[type="track"]')];

	const parsed = tracks
		.map(track => {
			const player = track.querySelector('Player');

			const trackArtist = (track.getAttribute('originalTitle') || track.getAttribute('grandparentTitle') || '').trim();

			const grandparentTitle = (track.getAttribute('grandparentTitle') || '').trim();
			const albumArtist = (grandparentTitle && grandparentTitle !== trackArtist && grandparentTitle.toLowerCase() !== 'various artists')
				? grandparentTitle
				: '';

			return {
				sessionKey: track.getAttribute('sessionKey'),
				title: track.getAttribute('title'),
				trackArtist,
				albumArtist,
				album: track.getAttribute('parentTitle'),
				art: track.getAttribute('parentThumb') || track.getAttribute('grandparentThumb'),
				duration: Number(track.getAttribute('duration')),
				offset: Number(track.getAttribute('viewOffset')),
				state: player?.getAttribute('state'),
				player: player?.getAttribute('title'),
				product: player?.getAttribute('product'),
			};
		})
		.filter(s => s.state === 'playing');

	sessions.update(prev =>
		parsed.map(s => {
			const old = prev.find(p => p.sessionKey === s.sessionKey);
			return {
				...s,
				localOffset: old?.localOffset ?? s.offset
			};
		})
	);

	activeIndex.update(i => (parsed.length ? i % parsed.length : 0));

	startRotation(parsed.length);
	startProgress();
}

function startRotation(count) {
	clearInterval(rotationTimer);
	if (count <= 1) return;

	rotationTimer = setInterval(() => {
		activeIndex.update(i => (i + 1) % count);
	}, 10000);
}

function startProgress() {
	clearInterval(progressTimer);
	progressTimer = setInterval(() => {
		sessions.update(list =>
			list.map(s =>
				s.state === 'playing'
				? { ...s, localOffset: Math.min(s.localOffset + 1000, s.duration) }
				: s
			)
		);
	}, 1000);
}

export function connectWebSocket() {
	const ws = new WebSocket(`ws://plex.ichaival:32400/:/websockets/notifications?X-Plex-Token=${TOKEN}`);

	ws.onmessage = () => fetchNowPlaying();
	ws.onerror = () => setInterval(fetchNowPlaying, 2000);
}
