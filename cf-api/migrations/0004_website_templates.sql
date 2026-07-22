-- website_templates: Header, footer desktop, footer mobile template system
-- 3 slots per type, 1 active per type. Admin switches template design via dropdown.
-- Sync writes active templates to GitHub Hugo partials.

CREATE TABLE IF NOT EXISTS website_templates (
  id          TEXT PRIMARY KEY,                             -- e.g. 'header-1', 'footer_desktop-2'
  type        TEXT NOT NULL CHECK(type IN ('header','footer_desktop','footer_mobile')),
  slot        INTEGER NOT NULL CHECK(slot IN (1,2,3)),
  name        TEXT NOT NULL,
  html_content TEXT NOT NULL DEFAULT '',
  is_active   INTEGER NOT NULL DEFAULT 0 CHECK(is_active IN (0,1)),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_templates_type ON website_templates(type);
CREATE INDEX IF NOT EXISTS idx_templates_active ON website_templates(type, is_active);
