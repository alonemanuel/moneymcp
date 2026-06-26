-- Sample data for LOCAL testing only (wrangler dev). Not used in production.
DELETE FROM transactions;
DELETE FROM scrape_runs;

INSERT INTO transactions (hash, account, date, description, memo, amount, currency, status, type, category, scraped_at) VALUES
  ('h1',  '12-345-678', '2026-06-02', 'שופרסל דיל',            NULL, -412.90,  'ILS', 'completed', 'normal', 'Groceries',   '2026-06-26T08:00:00Z'),
  ('h2',  '12-345-678', '2026-06-03', 'PAYBOX העברה',          NULL, -150.00,  'ILS', 'completed', 'normal', 'Transfer',    '2026-06-26T08:00:00Z'),
  ('h3',  '12-345-678', '2026-06-05', 'משכורת',                NULL,  18500.00,'ILS', 'completed', 'normal', 'Salary',      '2026-06-26T08:00:00Z'),
  ('h4',  '12-345-678', '2026-06-07', 'חברת חשמל',             NULL, -389.00,  'ILS', 'completed', 'normal', 'Utilities',   '2026-06-26T08:00:00Z'),
  ('h5',  '12-345-678', '2026-06-09', 'Apple.com/bill',        NULL, -34.90,   'ILS', 'completed', 'normal', 'Subscriptions','2026-06-26T08:00:00Z'),
  ('h6',  '12-345-678', '2026-06-11', 'רמי לוי',               NULL, -287.45,  'ILS', 'completed', 'normal', 'Groceries',   '2026-06-26T08:00:00Z'),
  ('h7',  '12-345-678', '2026-06-13', 'דלק תחנת דלק',          NULL, -300.00,  'ILS', 'completed', 'normal', 'Fuel',        '2026-06-26T08:00:00Z'),
  ('h8',  '12-345-678', '2026-06-15', 'ביטוח לאומי',           NULL, -1240.00, 'ILS', 'completed', 'normal', 'Insurance',   '2026-06-26T08:00:00Z'),
  ('h9',  '12-345-678', '2026-06-18', 'Wolt',                  NULL, -96.00,   'ILS', 'completed', 'normal', 'Restaurants', '2026-06-26T08:00:00Z'),
  ('h10', '12-345-678', '2026-06-20', 'שכר דירה',              NULL, -5800.00, 'ILS', 'completed', 'normal', 'Rent',        '2026-06-26T08:00:00Z'),
  ('h11', '12-345-678', '2026-06-22', 'Netflix',               NULL, -54.90,   'ILS', 'completed', 'normal', 'Subscriptions','2026-06-26T08:00:00Z'),
  ('h12', '12-345-678', '2026-06-24', 'אמזון',                 NULL, -612.30,  'ILS', 'completed', 'normal', 'Shopping',    '2026-06-26T08:00:00Z');

INSERT INTO scrape_runs (started_at, finished_at, success, inserted, error) VALUES
  ('2026-06-26T08:00:00Z', '2026-06-26T08:00:42Z', 1, 12, NULL);
