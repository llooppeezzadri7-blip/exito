-- Autonomous discovery: Google Places is no longer a data source.
--
-- Businesses now come from open, keyless sources (OpenStreetMap via Overpass,
-- the official Catalan tourism registry, public directories) plus CSV import.
-- Each record also carries how many independent sources corroborated it, which
-- is what separates PROBABLE from VERIFICADO.

alter table public.businesses
  drop constraint if exists businesses_source_check;

alter table public.businesses
  add constraint businesses_source_check
  check (source in ('csv_import', 'manual', 'openstreetmap', 'turisme_cat', 'directory', 'website'));

-- Sources that independently reported this business, e.g.
-- ['openstreetmap','turisme_cat']. One entry means PROBABLE; two or more that
-- agree means VERIFICADO. Never inferred — only written when a source actually
-- returned the record.
alter table public.businesses
  add column if not exists corroborating_sources text[] not null default '{}';

-- Verification state of the business's identity as a whole.
alter table public.businesses
  add column if not exists verification_status text not null default 'PROBABLE'
  check (verification_status in ('VERIFICADO', 'PROBABLE', 'NO_VERIFICADO'));

-- local_audits kept its Google-specific default; the data now comes from
-- whichever open source produced it.
alter table public.local_audits
  alter column source set default 'openstreetmap';
