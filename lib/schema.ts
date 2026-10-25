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
`;
