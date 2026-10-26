# Kora Manager

A football manager game for phones (landscape). Build a club from packs, set tactics, and play a home-and-away league against friends and strong AI clubs. Matches are simulated on the server at kick-off time; anyone can watch a 2-minute replay or skip to the result.

## What is in this version

- **Leagues**: 8 player pools, 10/16/20/30 clubs, AI difficulty. Empty places become AI clubs with names from that country.
- **Fixed daily schedule**: one match day every day at the league's chosen time (home and away league, a knockout cup, a free day at the halfway break). Nobody can play a match early.
- **Live matches**: a match goes live at kick-off for about 2 minutes. Managers get a kick-off alert (watch or skip), and while watching can change the game plan or make subs; the match is re-simulated from that minute. Skipped matches are run by the assistant. Goal, card, injury, penalty, sub, crowd animations and sounds.
- **Derby**: two manager Fan Clubs meet in a gold derby with tension, a press conference tone and more cards.
- **Cup**: single-leg knockout with an animated draw, penalties straight after a draw in the order you set.
- **Club**: packs (Legend, Gold, Silver, Bronze, Staff), line-up editor, advanced tactics with a scout report, penalties and assistant rules, training (a skill or a new position), squad condition with doctor, physio and coach, office with board, sponsor and squad targets, sponsor deals, fans, stadium name and expansion.
- **League life**: table, fixtures, stat leaders, a newspaper for every match day with managers' comments, Team of the Week (+2 for 2 days) and Player of the Month (winner +3, sulking nominees −2).
- **Transfer market**: only listed players, open in pre-season and at the halfway break.

## Run on your computer

```bash
npm install
npm run seed      # creates the local database in ./.data and loads the players
npm run dev
```

Open http://localhost:3000. Full season test without the browser: `npm run test:season -- ENG 10`

## Online on Cloudflare (free)

The app runs as a Cloudflare Worker (built with OpenNext) and stores data in Neon Postgres.
Every push to `main` deploys automatically through `.github/workflows/deploy.yml`.

1. **Neon**: create a project at neon.tech (region Frankfurt) and copy the connection string.
2. **Cloudflare**: sign up at cloudflare.com, open *Workers & Pages* once (this creates your free `*.workers.dev` address).
   Copy your **Account ID** (shown on the Workers & Pages page) and create an **API token** at
   *My Profile → API Tokens → Create Token → "Edit Cloudflare Workers"* template.
3. **GitHub**: in this repository open *Settings → Secrets and variables → Actions* and add:
   - `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
   - `DATABASE_URL` (from Neon)
   - `SESSION_SECRET`, `CRON_SECRET` (any long random texts)
4. Open *Actions → Deploy to Cloudflare → Run workflow*. When it finishes, the game is live at
   `https://kora-manager.<your-subdomain>.workers.dev`.

How matches run on the free plan: Cloudflare gives each request about 10 ms of CPU, so one request plays
one match. A timer in `worker.ts` runs every minute and plays all due matches one by one, and the league and
match pages also play due matches while someone is watching, so kick-offs happen on time.

## Data note

Player names and ratings come from public football data and are for private testing only. Club names are invented. The Egyptian pool and the goalkeeper positions are topped up with fictional academy players (marked *Academy*) so every pool supports a 30-club league. Replace the data with licensed data before any public release.
