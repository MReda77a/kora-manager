export const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  pass_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  pool TEXT NOT NULL,
  nat TEXT NOT NULL,
  pos TEXT NOT NULL,
  foot TEXT NOT NULL,
  age INT NOT NULL,
  height INT NOT NULL,
  ovr INT NOT NULL,
  pot INT NOT NULL,
  attrs JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS players_pool ON players (pool, ovr);

CREATE TABLE IF NOT EXISTS leagues (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT UNIQUE NOT NULL,
  owner_id INT NOT NULL REFERENCES users(id),
  pool TEXT NOT NULL,
  max_clubs INT NOT NULL,
  ai_level INT NOT NULL DEFAULT 1,
  interval_min INT NOT NULL DEFAULT 1440,
  kickoff_utc_min INT NOT NULL DEFAULT 1080,
  status TEXT NOT NULL DEFAULT 'setup',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS clubs (
  id SERIAL PRIMARY KEY,
  league_id INT NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  user_id INT REFERENCES users(id),
  name TEXT NOT NULL,
  short TEXT NOT NULL,
  color1 TEXT NOT NULL,
  color2 TEXT NOT NULL,
  shape INT NOT NULL DEFAULT 0,
  emblem INT NOT NULL DEFAULT 0,
  stadium TEXT NOT NULL DEFAULT 'Home Ground',
  club_type TEXT NOT NULL DEFAULT 'fan',
  coins INT NOT NULL DEFAULT 1000,
  money NUMERIC NOT NULL DEFAULT 15,
  tactic JSONB NOT NULL DEFAULT '{}'::jsonb,
  lineup JSONB NOT NULL DEFAULT '[]'::jsonb,
  pens JSONB NOT NULL DEFAULT '[]'::jsonb,
  assistant JSONB NOT NULL DEFAULT '{"tired":true,"cards":true,"winning":true,"losing":true}'::jsonb,
  UNIQUE (league_id, user_id)
);

CREATE TABLE IF NOT EXISTS squad (
  league_id INT NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  player_id TEXT NOT NULL REFERENCES players(id),
  club_id INT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  fitness INT NOT NULL DEFAULT 100,
  out_until INT NOT NULL DEFAULT 0,
  out_reason TEXT,
  PRIMARY KEY (league_id, player_id)
);
CREATE INDEX IF NOT EXISTS squad_club ON squad (club_id);

CREATE TABLE IF NOT EXISTS fixtures (
  id SERIAL PRIMARY KEY,
  league_id INT NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  matchday INT NOT NULL,
  home_id INT NOT NULL REFERENCES clubs(id),
  away_id INT NOT NULL REFERENCES clubs(id),
  kickoff_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled',
  home_goals INT,
  away_goals INT,
  report JSONB,
  claimed_at TIMESTAMPTZ
);
ALTER TABLE fixtures ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS fixtures_due ON fixtures (status, kickoff_at);
CREATE INDEX IF NOT EXISTS fixtures_league ON fixtures (league_id, matchday);

CREATE TABLE IF NOT EXISTS listings (
  id SERIAL PRIMARY KEY,
  league_id INT NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  player_id TEXT NOT NULL REFERENCES players(id),
  seller_id INT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  price NUMERIC NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (league_id, player_id)
);

CREATE TABLE IF NOT EXISTS pstats (
  league_id INT NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  player_id TEXT NOT NULL REFERENCES players(id),
  club_id INT NOT NULL,
  apps INT NOT NULL DEFAULT 0,
  goals INT NOT NULL DEFAULT 0,
  assists INT NOT NULL DEFAULT 0,
  yellows INT NOT NULL DEFAULT 0,
  reds INT NOT NULL DEFAULT 0,
  clean_sheets INT NOT NULL DEFAULT 0,
  motm INT NOT NULL DEFAULT 0,
  rating_sum NUMERIC NOT NULL DEFAULT 0,
  PRIMARY KEY (league_id, player_id)
);

CREATE TABLE IF NOT EXISTS news (
  id SERIAL PRIMARY KEY,
  league_id INT NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  club_id INT,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
)
;
ALTER TABLE leagues ADD COLUMN IF NOT EXISTS season INT NOT NULL DEFAULT 1;
ALTER TABLE clubs ADD COLUMN IF NOT EXISTS fans INT NOT NULL DEFAULT 20000;
ALTER TABLE clubs ADD COLUMN IF NOT EXISTS capacity INT NOT NULL DEFAULT 30000;
ALTER TABLE clubs ADD COLUMN IF NOT EXISTS board INT NOT NULL DEFAULT 60;
ALTER TABLE clubs ADD COLUMN IF NOT EXISTS sponsor TEXT;
ALTER TABLE clubs ADD COLUMN IF NOT EXISTS sales NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE squad ADD COLUMN IF NOT EXISTS pos_override TEXT;
ALTER TABLE squad ADD COLUMN IF NOT EXISTS boost JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE squad ADD COLUMN IF NOT EXISTS form_mod INT NOT NULL DEFAULT 0;
ALTER TABLE squad ADD COLUMN IF NOT EXISTS form_until INT NOT NULL DEFAULT 0;
ALTER TABLE squad ADD COLUMN IF NOT EXISTS form_note TEXT;
ALTER TABLE fixtures ADD COLUMN IF NOT EXISTS comp TEXT NOT NULL DEFAULT 'league';
ALTER TABLE fixtures ADD COLUMN IF NOT EXISTS round INT;
ALTER TABLE fixtures ADD COLUMN IF NOT EXISTS day INT NOT NULL DEFAULT 0;
ALTER TABLE fixtures ADD COLUMN IF NOT EXISTS sides JSONB;
ALTER TABLE fixtures ADD COLUMN IF NOT EXISTS changes JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE fixtures ADD COLUMN IF NOT EXISTS live_from TIMESTAMPTZ;
ALTER TABLE fixtures ADD COLUMN IF NOT EXISTS live_until TIMESTAMPTZ;
ALTER TABLE fixtures ADD COLUMN IF NOT EXISTS winner_id INT;
CREATE INDEX IF NOT EXISTS fixtures_live ON fixtures (status, live_until);

CREATE TABLE IF NOT EXISTS days (
  league_id INT NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  day INT NOT NULL,
  kind TEXT NOT NULL,
  matchday INT,
  round INT,
  kickoff_at TIMESTAMPTZ NOT NULL,
  processed BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (league_id, day)
);

CREATE TABLE IF NOT EXISTS staff (
  id SERIAL PRIMARY KEY,
  league_id INT NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  club_id INT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  name TEXT NOT NULL,
  level INT NOT NULL
);

CREATE TABLE IF NOT EXISTS training (
  id SERIAL PRIMARY KEY,
  league_id INT NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  club_id INT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  player_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  target TEXT NOT NULL,
  amount INT NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ends_at TIMESTAMPTZ NOT NULL,
  done BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS comments (
  id SERIAL PRIMARY KEY,
  league_id INT NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  club_id INT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  fixture_id INT,
  day INT NOT NULL,
  tone TEXT,
  text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS papers (
  league_id INT NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  day INT NOT NULL,
  kind TEXT NOT NULL,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (league_id, day, kind)
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS reputation INT NOT NULL DEFAULT 0;
ALTER TABLE leagues ADD COLUMN IF NOT EXISTS divisions INT NOT NULL DEFAULT 1;
ALTER TABLE leagues ADD COLUMN IF NOT EXISTS start_division TEXT NOT NULL DEFAULT 'bottom';
ALTER TABLE clubs ADD COLUMN IF NOT EXISTS division INT NOT NULL DEFAULT 1;
ALTER TABLE clubs ADD COLUMN IF NOT EXISTS away1 TEXT;
ALTER TABLE clubs ADD COLUMN IF NOT EXISTS away2 TEXT;
ALTER TABLE clubs ADD COLUMN IF NOT EXISTS pattern INT NOT NULL DEFAULT 0;
ALTER TABLE clubs ADD COLUMN IF NOT EXISTS plans JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE clubs ADD COLUMN IF NOT EXISTS roles JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE clubs ADD COLUMN IF NOT EXISTS setpieces JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE clubs ADD COLUMN IF NOT EXISTS familiarity JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE squad ADD COLUMN IF NOT EXISTS morale INT NOT NULL DEFAULT 70;
ALTER TABLE squad ADD COLUMN IF NOT EXISTS ovr_delta INT NOT NULL DEFAULT 0;
ALTER TABLE squad ADD COLUMN IF NOT EXISTS age_add INT NOT NULL DEFAULT 0;
ALTER TABLE squad ADD COLUMN IF NOT EXISTS loan_from INT;
ALTER TABLE squad ADD COLUMN IF NOT EXISTS request BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE squad ADD COLUMN IF NOT EXISTS talk_day INT NOT NULL DEFAULT 0;
ALTER TABLE squad ADD COLUMN IF NOT EXISTS promise_day INT NOT NULL DEFAULT 0;
ALTER TABLE fixtures ADD COLUMN IF NOT EXISTS division INT NOT NULL DEFAULT 1;
ALTER TABLE fixtures ADD COLUMN IF NOT EXISTS press JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE clubs ADD COLUMN IF NOT EXISTS prev_pos INT;

CREATE TABLE IF NOT EXISTS history (
  league_id INT NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  season INT NOT NULL,
  data JSONB NOT NULL,
  PRIMARY KEY (league_id, season)
);

CREATE TABLE IF NOT EXISTS trophies (
  id SERIAL PRIMARY KEY,
  league_id INT NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  club_id INT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  user_id INT,
  season INT NOT NULL,
  kind TEXT NOT NULL,
  label TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS career (
  league_id INT NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  club_id INT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  player_id TEXT NOT NULL,
  apps INT NOT NULL DEFAULT 0,
  goals INT NOT NULL DEFAULT 0,
  assists INT NOT NULL DEFAULT 0,
  seasons INT NOT NULL DEFAULT 0,
  PRIMARY KEY (league_id, club_id, player_id)
);

CREATE TABLE IF NOT EXISTS retired (
  league_id INT NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  player_id TEXT NOT NULL,
  PRIMARY KEY (league_id, player_id)
);

CREATE TABLE IF NOT EXISTS offers (
  id SERIAL PRIMARY KEY,
  league_id INT NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  from_club INT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  to_club INT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  player_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  amount NUMERIC NOT NULL DEFAULT 0,
  swap_player TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  counter NUMERIC,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS offers_to ON offers (to_club, status);
CREATE INDEX IF NOT EXISTS offers_from ON offers (from_club, status);

CREATE TABLE IF NOT EXISTS push_subs (
  endpoint TEXT PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  keys JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS push_subs_user ON push_subs (user_id);
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
ALTER TABLE users ADD COLUMN IF NOT EXISTS tutorial_done BOOLEAN NOT NULL DEFAULT false;

-- AI clubs are never Fan Clubs: spread existing ones over the other four styles
UPDATE clubs SET club_type = (ARRAY['invest','academy','commercial','historic'])[1 + (id % 4)] WHERE user_id IS NULL AND club_type = 'fan';

-- players offered by clubs abroad during a transfer window
CREATE TABLE IF NOT EXISTS abroad (
  id SERIAL PRIMARY KEY,
  league_id INT NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  player_id TEXT NOT NULL REFERENCES players(id),
  price NUMERIC NOT NULL,
  club TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (league_id, player_id)
);

-- the match analyst: its level (1 free, 2 and 3 bought) and the last report per fixture
ALTER TABLE clubs ADD COLUMN IF NOT EXISTS analyst INT NOT NULL DEFAULT 1;
CREATE TABLE IF NOT EXISTS analyst_reports (
  club_id INT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  fixture_id INT NOT NULL REFERENCES fixtures(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (club_id, fixture_id)
);

-- each player's shirt number at his club (unique within the club)
ALTER TABLE squad ADD COLUMN IF NOT EXISTS shirt INT;

-- friendlies: played on the spot, only the result and the stats are kept
CREATE TABLE IF NOT EXISTS friendlies (
  id SERIAL PRIMARY KEY,
  league_id INT NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  club_id INT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  opp_id INT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  day INT NOT NULL,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- chemistry between two team-mates (player ids in order a < b)
CREATE TABLE IF NOT EXISTS chemistry (
  club_id INT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  a TEXT NOT NULL,
  b TEXT NOT NULL,
  v REAL NOT NULL,
  PRIMARY KEY (club_id, a, b)
);
-- squads that existed before chemistry: their players already know each other (once per club)
INSERT INTO chemistry (club_id, a, b, v)
SELECT s1.club_id, s1.player_id, s2.player_id, 55 FROM squad s1 JOIN squad s2 ON s2.club_id = s1.club_id AND s1.player_id < s2.player_id
  JOIN clubs c ON c.id = s1.club_id AND c.user_id IS NOT NULL
  JOIN leagues l ON l.id = c.league_id AND l.status <> 'setup'
WHERE NOT EXISTS (SELECT 1 FROM chemistry ch WHERE ch.club_id = s1.club_id)
ON CONFLICT DO NOTHING;

-- one price scale for every player (same formula as marketValue in game.ts)
UPDATE players SET attrs = jsonb_set(attrs, '{v}', to_jsonb(
  CASE WHEN x.v >= 10 THEN round(x.v) ELSE round(x.v::numeric, 1) END))
FROM (SELECT id, GREATEST(0.3, 3 * power(1.24, ovr - 76)
        * (CASE WHEN age <= 21 THEN 1.35 WHEN age <= 24 THEN 1.2 WHEN age <= 28 THEN 1 WHEN age <= 30 THEN 0.85 WHEN age <= 32 THEN 0.65 ELSE 0.45 END)
        * (CASE WHEN age <= 24 THEN 1 + GREATEST(0, pot - ovr) * 0.03 ELSE 1 END))::numeric AS v FROM players) x
WHERE players.id = x.id;
-- players from abroad and AI clubs' listings already on the market follow the new prices
UPDATE abroad a SET price = GREATEST(0.5, (p.attrs->>'v')::numeric) FROM players p WHERE p.id = a.player_id;
UPDATE listings li SET price = GREATEST(0.5, round((p.attrs->>'v')::numeric * 1.1, 1)) FROM players p, clubs c
  WHERE p.id = li.player_id AND c.id = li.seller_id AND c.user_id IS NULL;
-- price talks: rounds so far, and the AI's hidden limit and current asking price
ALTER TABLE offers ADD COLUMN IF NOT EXISTS rounds INT NOT NULL DEFAULT 0;
ALTER TABLE offers ADD COLUMN IF NOT EXISTS reserve NUMERIC;
ALTER TABLE offers ADD COLUMN IF NOT EXISTS ask NUMERIC;
-- the captain and vice-captain (player ids), and how many matches in a row a fit captain was left out
ALTER TABLE clubs ADD COLUMN IF NOT EXISTS captain TEXT;
ALTER TABLE clubs ADD COLUMN IF NOT EXISTS vice TEXT;
ALTER TABLE squad ADD COLUMN IF NOT EXISTS cap_miss INT NOT NULL DEFAULT 0;
-- big-match press conferences: what each manager said and what it does to the match
CREATE TABLE IF NOT EXISTS pressers (
  id SERIAL PRIMARY KEY,
  league_id INT NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  fixture_id INT NOT NULL REFERENCES fixtures(id) ON DELETE CASCADE,
  club_id INT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  questions JSONB NOT NULL DEFAULT '[]'::jsonb,
  answers JSONB NOT NULL DEFAULT '[]'::jsonb,
  effects JSONB NOT NULL DEFAULT '{}'::jsonb,
  done BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (fixture_id, club_id)
);
CREATE INDEX IF NOT EXISTS pressers_club ON pressers (club_id);
-- every transfer in a league, for the transfer history
CREATE TABLE IF NOT EXISTS transfers (
  id SERIAL PRIMARY KEY,
  league_id INT NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  season INT NOT NULL DEFAULT 1,
  day INT NOT NULL DEFAULT 0,
  player_id TEXT NOT NULL,
  player_name TEXT NOT NULL,
  from_club INT,
  from_name TEXT NOT NULL,
  to_club INT,
  to_name TEXT NOT NULL,
  fee NUMERIC NOT NULL DEFAULT 0,
  kind TEXT NOT NULL DEFAULT 'buy',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS transfers_league ON transfers (league_id, id DESC);
`;
