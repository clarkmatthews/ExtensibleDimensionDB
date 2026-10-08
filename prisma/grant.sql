-- Run this as a PostgreSQL superuser. dimensionUser cannot create tables in public.
GRANT USAGE, CREATE ON SCHEMA public TO "dimensionUser";
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO "dimensionUser";
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO "dimensionUser";
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO "dimensionUser";
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO "dimensionUser";
