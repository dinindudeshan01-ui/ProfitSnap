-- Self-reported district, used for the admin "shops by district" map.
-- Not GPS/IP-based location tracking — the tenant picks it once in
-- Settings, same as any other profile field. Nullable: existing tenants
-- and anyone who skips it just don't show up on the map yet.
alter table tenants add column if not exists district text;
