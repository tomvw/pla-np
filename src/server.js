import express from 'express';
import fetch from 'node-fetch';

const app = express();
const PLEX_URL = 'http://plex.ichaival:32400';
const TOKEN = process.env.PLEX_TOKEN;

app.get('/now-playing', async (_, res) => {
	const r = await fetch(`${PLEX_URL}/status/sessions?X-Plex-Token=${TOKEN}`);
	res.send(await r.text());
});

app.listen(3001);
