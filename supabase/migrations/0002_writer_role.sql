-- pipeline writer role: least privilege on agri schema; bypasses RLS (anon stays read-only)
-- role created out-of-band with a secret password: create role agrinet_writer login password '<secret>';
grant usage on schema agri to agrinet_writer;
grant select, insert, update, delete, truncate on all tables in schema agri to agrinet_writer;
grant usage, select, update on all sequences in schema agri to agrinet_writer;
alter default privileges in schema agri grant select, insert, update, delete, truncate on tables to agrinet_writer;
grant usage on schema extensions to agrinet_writer;
alter role agrinet_writer bypassrls;
