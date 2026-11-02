-- Spike用の最小スキーマ。条・項・号の単位を内部IDで持つ
CREATE TABLE law_revisions (
  revision_id TEXT PRIMARY KEY,
  law_id TEXT NOT NULL,
  title TEXT NOT NULL,
  enforcement_date TEXT NOT NULL
);
CREATE TABLE provision_versions (
  revision_id TEXT NOT NULL,
  provision_id TEXT NOT NULL,
  ord INTEGER NOT NULL,
  key TEXT NOT NULL,
  kind TEXT NOT NULL,
  num TEXT NOT NULL,
  title TEXT NOT NULL,
  caption TEXT NOT NULL,
  deleted INTEGER NOT NULL,
  PRIMARY KEY (revision_id, provision_id)
);
CREATE TABLE unit_versions (
  revision_id TEXT NOT NULL,
  unit_id TEXT NOT NULL,
  provision_id TEXT NOT NULL,
  ord INTEGER NOT NULL,
  path TEXT NOT NULL,
  label TEXT NOT NULL,
  text TEXT NOT NULL,
  PRIMARY KEY (revision_id, unit_id)
);
CREATE INDEX unit_versions_provision ON unit_versions (revision_id, provision_id, ord);
CREATE VIRTUAL TABLE unit_fts USING fts5 (
  law_title, article_title, text,
  revision_id UNINDEXED, provision_id UNINDEXED,
  tokenize = 'trigram'
);
-- 2文字語用：アプリ側で文字bigramに区切ってから入れる
CREATE VIRTUAL TABLE unit_bigram USING fts5 (
  text, revision_id UNINDEXED, provision_id UNINDEXED,
  tokenize = 'unicode61'
);
