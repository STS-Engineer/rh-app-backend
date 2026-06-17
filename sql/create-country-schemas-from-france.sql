-- Creates empty country schemas using schema_fr as the template.
-- Run this on the HR application database after schema_fr exists.
--
-- Current mapping:
--   Tunisia      -> public (kept unchanged for the current app)
--   France       -> schema_fr (template, already exists)
--   China        -> schema_cn
--   Germany      -> schema_de
--   India        -> schema_in
--   Luxembourg   -> schema_lu
--   Mexico       -> schema_mx
--   South Korea  -> schema_kr

BEGIN;

DO $$
DECLARE
  source_schema text := 'schema_fr';
  target_schema text;
  table_name text;
  type_name text;
  enum_values text;
  serial_table text;
  target_schemas text[] := ARRAY[
    'schema_cn',
    'schema_de',
    'schema_in',
    'schema_lu',
    'schema_mx',
    'schema_kr'
  ];
  template_tables text[] := ARRAY[
    'employees',
    'demande_rh',
    'leave_balances',
    'pdf_metadata',
    'visa_dossiers',
    'visa_documents',
    'emergency_contacts',
    'onboarding_records',
    'onboarding_tasks',
    'career_events',
    'offboarding_records',
    'offboarding_tasks'
  ];
  id_tables text[] := ARRAY[
    'employees',
    'demande_rh',
    'pdf_metadata',
    'visa_dossiers',
    'visa_documents',
    'emergency_contacts',
    'onboarding_records',
    'onboarding_tasks',
    'career_events',
    'offboarding_records',
    'offboarding_tasks'
  ];
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.schemata
    WHERE schema_name = source_schema
  ) THEN
    RAISE EXCEPTION 'Source schema % does not exist', source_schema;
  END IF;

  FOREACH target_schema IN ARRAY target_schemas LOOP
    EXECUTE format('CREATE SCHEMA IF NOT EXISTS %I', target_schema);

    FOREACH type_name IN ARRAY ARRAY['mode_document', 'statut_document', 'statut_dossier'] LOOP
      IF EXISTS (
        SELECT 1
        FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = source_schema
          AND t.typname = type_name
      ) AND NOT EXISTS (
        SELECT 1
        FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = target_schema
          AND t.typname = type_name
      ) THEN
        SELECT string_agg(quote_literal(e.enumlabel), ', ' ORDER BY e.enumsortorder)
        INTO enum_values
        FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = source_schema
          AND t.typname = type_name;

        EXECUTE format('CREATE TYPE %I.%I AS ENUM (%s)', target_schema, type_name, enum_values);
      END IF;
    END LOOP;

    FOREACH table_name IN ARRAY template_tables LOOP
      EXECUTE format(
        'CREATE TABLE IF NOT EXISTS %I.%I (LIKE %I.%I INCLUDING ALL)',
        target_schema,
        table_name,
        source_schema,
        table_name
      );
    END LOOP;

    FOREACH serial_table IN ARRAY id_tables LOOP
      EXECUTE format(
        'CREATE SEQUENCE IF NOT EXISTS %I.%I',
        target_schema,
        serial_table || '_id_seq'
      );
      EXECUTE format(
        'ALTER SEQUENCE %I.%I OWNED BY %I.%I.id',
        target_schema,
        serial_table || '_id_seq',
        target_schema,
        serial_table
      );
      EXECUTE format(
        'ALTER TABLE %I.%I ALTER COLUMN id SET DEFAULT nextval(%L::regclass)',
        target_schema,
        serial_table,
        target_schema || '.' || serial_table || '_id_seq'
      );
    END LOOP;

    IF EXISTS (
      SELECT 1
      FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = target_schema
        AND t.typname = 'statut_document'
    ) THEN
      EXECUTE format('ALTER TABLE %I.visa_documents ALTER COLUMN statut DROP DEFAULT', target_schema);
      EXECUTE format(
        'ALTER TABLE %I.visa_documents ALTER COLUMN mode TYPE %I.mode_document USING mode::text::%I.mode_document',
        target_schema,
        target_schema,
        target_schema
      );
      EXECUTE format(
        'ALTER TABLE %I.visa_documents ALTER COLUMN statut TYPE %I.statut_document USING statut::text::%I.statut_document',
        target_schema,
        target_schema,
        target_schema
      );
      EXECUTE format(
        'ALTER TABLE %I.visa_documents ALTER COLUMN statut SET DEFAULT %L::%I.statut_document',
        target_schema,
        'MISSING',
        target_schema
      );
    END IF;

    IF EXISTS (
      SELECT 1
      FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = target_schema
        AND t.typname = 'statut_dossier'
    ) THEN
      EXECUTE format('ALTER TABLE %I.visa_dossiers ALTER COLUMN statut DROP DEFAULT', target_schema);
      EXECUTE format(
        'ALTER TABLE %I.visa_dossiers ALTER COLUMN statut TYPE %I.statut_dossier USING statut::text::%I.statut_dossier',
        target_schema,
        target_schema,
        target_schema
      );
      EXECUTE format(
        'ALTER TABLE %I.visa_dossiers ALTER COLUMN statut SET DEFAULT %L::%I.statut_dossier',
        target_schema,
        'EN_COURS',
        target_schema
      );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE connamespace = target_schema::regnamespace AND conname = 'career_events_employee_id_fkey') THEN
      EXECUTE format('ALTER TABLE %I.career_events ADD CONSTRAINT career_events_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES %I.employees(id) ON DELETE CASCADE', target_schema, target_schema);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE connamespace = target_schema::regnamespace AND conname = 'demande_rh_employe_id_fkey') THEN
      EXECUTE format('ALTER TABLE %I.demande_rh ADD CONSTRAINT demande_rh_employe_id_fkey FOREIGN KEY (employe_id) REFERENCES %I.employees(id)', target_schema, target_schema);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE connamespace = target_schema::regnamespace AND conname = 'emergency_contacts_employee_id_fkey') THEN
      EXECUTE format('ALTER TABLE %I.emergency_contacts ADD CONSTRAINT emergency_contacts_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES %I.employees(id) ON DELETE CASCADE', target_schema, target_schema);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE connamespace = target_schema::regnamespace AND conname = 'leave_balances_employee_id_fkey') THEN
      EXECUTE format('ALTER TABLE %I.leave_balances ADD CONSTRAINT leave_balances_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES %I.employees(id) ON DELETE CASCADE', target_schema, target_schema);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE connamespace = target_schema::regnamespace AND conname = 'offboarding_records_employee_id_fkey') THEN
      EXECUTE format('ALTER TABLE %I.offboarding_records ADD CONSTRAINT offboarding_records_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES %I.employees(id) ON DELETE CASCADE', target_schema, target_schema);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE connamespace = target_schema::regnamespace AND conname = 'offboarding_tasks_offboarding_id_fkey') THEN
      EXECUTE format('ALTER TABLE %I.offboarding_tasks ADD CONSTRAINT offboarding_tasks_offboarding_id_fkey FOREIGN KEY (offboarding_id) REFERENCES %I.offboarding_records(id) ON DELETE CASCADE', target_schema, target_schema);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE connamespace = target_schema::regnamespace AND conname = 'onboarding_records_employee_id_fkey') THEN
      EXECUTE format('ALTER TABLE %I.onboarding_records ADD CONSTRAINT onboarding_records_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES %I.employees(id) ON DELETE CASCADE', target_schema, target_schema);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE connamespace = target_schema::regnamespace AND conname = 'onboarding_tasks_onboarding_id_fkey') THEN
      EXECUTE format('ALTER TABLE %I.onboarding_tasks ADD CONSTRAINT onboarding_tasks_onboarding_id_fkey FOREIGN KEY (onboarding_id) REFERENCES %I.onboarding_records(id) ON DELETE CASCADE', target_schema, target_schema);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE connamespace = target_schema::regnamespace AND conname = 'pdf_metadata_employee_id_fkey') THEN
      EXECUTE format('ALTER TABLE %I.pdf_metadata ADD CONSTRAINT pdf_metadata_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES %I.employees(id) ON DELETE CASCADE', target_schema, target_schema);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE connamespace = target_schema::regnamespace AND conname = 'visa_documents_dossier_id_fkey') THEN
      EXECUTE format('ALTER TABLE %I.visa_documents ADD CONSTRAINT visa_documents_dossier_id_fkey FOREIGN KEY (dossier_id) REFERENCES %I.visa_dossiers(id) ON DELETE CASCADE', target_schema, target_schema);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE connamespace = target_schema::regnamespace AND conname = 'visa_dossiers_employee_id_fkey') THEN
      EXECUTE format('ALTER TABLE %I.visa_dossiers ADD CONSTRAINT visa_dossiers_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES %I.employees(id)', target_schema, target_schema);
    END IF;
  END LOOP;
END $$;

COMMIT;
