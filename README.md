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
npm run dev
```

Open http://localhost:3000. With no `DATABASE_URL`, data is saved in `./.data`.

Season test without the browser: `npm run test:league -- ENG 20`

## Put it online (free tiers)

1. **Database (Neon)**: create a project at neon.tech (region: Frankfurt). Copy the connection string.
2. **Code (GitHub)**: create a private repository and upload this folder (without `node_modules`, `.next`, `.data`).
3. **Hosting (Vercel)**: import the repository at vercel.com. In *Environment Variables* add:
   - `DATABASE_URL` = the Neon connection string
   - `SESSION_SECRET` = a long random text
   - `CRON_SECRET` = another long random text
   Deploy. The first visit creates the tables and loads the players (takes a few seconds).
4. **Match timer (GitHub Actions)**: in the GitHub repository go to *Settings → Secrets and variables → Actions* and add:
   - `APP_URL` = your Vercel address, for example `https://kora-manager.vercel.app`
   - `CRON_SECRET` = the same value as on Vercel
   The workflow in `.github/workflows/cron.yml` then plays due matches every 5 minutes. Matches are also played the moment anyone opens the league or the match page, so kick-offs are on time when people are watching.

## Data note

Player names and ratings come from public football data and are for private testing only. Club names are invented. The Egyptian pool and the goalkeeper positions are topped up with fictional academy players (marked *Academy*) so every pool supports a 30-club league. Replace the data with licensed data before any public release.
