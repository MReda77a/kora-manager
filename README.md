# Kora Manager

A football manager game for phones (landscape). Build a club from packs, set tactics, and play a home-and-away league against friends and strong AI clubs. Matches are simulated on the server at kick-off time; anyone can watch a 2-minute replay or skip to the result.

## What is in this version

- Accounts (username + password)
- Create a league: player pool (8 leagues), 10/16/20/30 clubs, AI difficulty, match time (every day at a time you pick, every hour, or every 15 minutes for testing)
- Join with a 6-letter code, create your club (name, short name, stadium, crest, colours, club type)
- Pack store with 1000 coins: Legend 200, Gold 150, Silver 60, Bronze 25 (always a keeper). Packs only give players from the league's pool and every player has one owner per league
- Squad, fitness, injuries and suspensions
- Tactics: 5 formations, 6 game plans, 7 settings, drag-free line-up editor, penalty takers in order, assistant rules
- Match engine with tactical counters, fatigue, cards, injuries, penalties and assistant subs
- Watch a match in 2 minutes (1x/2x/4x, skip), live if you open it at kick-off, full-time report with stats, ratings and man of the match
- Derby (two manager Fan Clubs) in gold
- Table, fixtures, top scorers, assists, clean sheets, ratings, news feed
- Transfer market: only listed players; open before matchday 1 and at the halfway break
- League creator tools: change the match time, play the next matchday now (for testing)

Not in this version yet: cups, training, staff packs, team of the week and player of the month, live in-match decisions, newspaper comments.

## Run on your computer

```bash
npm install
npm run seed      # creates the local database in ./.data and loads the players
npm run dev
```

Open http://localhost:3000. Season test without the browser: `npm run test:league -- ENG 20`

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
