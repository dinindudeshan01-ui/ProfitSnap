-- migration-plans-addons.sql seeded the Free trial plan with 20 credits
-- — the real marketing (see the Facebook post) promises 100 free AI
-- credits on the 7-day trial. That seed only ran once via `where not
-- exists`, so if it already ran in your database, editing the seed file
-- itself won't fix the row that's already there — this updates it
-- directly, and is safe to run even if the seed hasn't run yet (the
-- WHERE clause just won't match anything in that case).
update plans
set credits_included = 100,
    features = '["100 free credits (7-day trial)", "Up to 30 scans/month", "1 shop"]'::jsonb
where name = 'Free' and credits_included = 20;
