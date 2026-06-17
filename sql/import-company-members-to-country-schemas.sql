-- Import company_members rows into the country HR schemas.
--
-- Assumption:
--   The source directory data is available in this database as public.company_members.
--   If your source is still in a separate database, first export it to CSV or load it
--   into a staging table with the same structure before running this script.
--
-- Target mapping:
--   Tunisia      -> public
--   France       -> schema_fr
--   China        -> schema_cn
--   Germany      -> schema_de
--   India        -> schema_in
--   Luxembourg   -> schema_lu
--   Mexico       -> schema_mx
--   South Korea  -> schema_kr
--
-- This script is idempotent:
--   re-running it updates existing employees by matricule.

BEGIN;

DO $$
DECLARE
  src record;
  target_schema text;
  normalized_country text;
BEGIN
  FOR src IN
    SELECT *
    FROM public.company_members
    ORDER BY id
  LOOP
    normalized_country := lower(trim(coalesce(src.country, '')));

    target_schema := CASE
      WHEN normalized_country = 'tunisia' THEN 'public'
      WHEN normalized_country = 'france' THEN 'schema_fr'
      WHEN normalized_country = 'china' THEN 'schema_cn'
      WHEN normalized_country = 'germany' THEN 'schema_de'
      WHEN normalized_country = 'india' THEN 'schema_in'
      WHEN normalized_country = 'luxembourg' THEN 'schema_lu'
      WHEN normalized_country = 'mexico' THEN 'schema_mx'
      WHEN normalized_country = 'south korea' THEN 'schema_kr'
      ELSE NULL
    END;

    IF target_schema IS NULL THEN
      RAISE NOTICE 'Skipping row id % because country % is not mapped', src.id, src.country;
      CONTINUE;
    END IF;

    IF target_schema = 'public' THEN
      INSERT INTO public.employees (
        matricule,
        nom,
        prenom,
        cin,
        passeport,
        date_naissance,
        poste,
        site_dep,
        type_contrat,
        date_debut,
        salaire_brute,
        photo,
        dossier_rh,
        date_depart,
        entretien_depart,
        statut,
        adresse_mail,
        mail_responsable1,
        mail_responsable2,
        pdf_archive_url,
        date_emission_passport,
        date_expiration_passport,
        date_fin_contrat
      )
      VALUES (
        left(coalesce(src.email, src.display_name, 'EMP-' || src.id::text), 50),
        coalesce(src.last_name, split_part(coalesce(src.display_name, ''), ' ', 1), 'UNKNOWN'),
        coalesce(src.first_name, split_part(coalesce(src.display_name, ''), ' ', 2), ''),
        NULL,
        NULL,
        NULL,
        coalesce(src.job_title, ''),
        coalesce(src.site, src.department, ''),
        'CDI',
        CURRENT_DATE,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        'actif',
        src.email,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL
      )
      ON CONFLICT (matricule) DO UPDATE SET
        nom = EXCLUDED.nom,
        prenom = EXCLUDED.prenom,
        poste = EXCLUDED.poste,
        site_dep = EXCLUDED.site_dep,
        adresse_mail = EXCLUDED.adresse_mail,
        updated_at = CURRENT_TIMESTAMP;

    ELSE
      EXECUTE format(
        $sql$
        INSERT INTO %I.employees (
          matricule,
          nom,
          prenom,
          numero_securite_sociale,
          passeport,
          date_emission_passport,
          date_expiration_passport,
          lieu_naissance,
          nationalite,
          date_naissance,
          poste,
          site_dep,
          type_contrat,
          date_debut,
          date_fin_contrat,
          salaire_brute,
          photo,
          dossier_rh,
          pdf_archive_url,
          adresse_mail,
          mail_responsable1,
          mail_responsable2,
          statut,
          date_depart,
          entretien_depart
        )
        VALUES (
          %L,
          %L,
          %L,
          NULL,
          NULL,
          NULL,
          NULL,
          NULL,
          %L,
          NULL,
          %L,
          %L,
          'CDI',
          CURRENT_DATE,
          NULL,
          NULL,
          NULL,
          NULL,
          NULL,
          %L,
          NULL,
          NULL,
          'actif',
          NULL,
          NULL
        )
        ON CONFLICT (matricule) DO UPDATE SET
          nom = EXCLUDED.nom,
          prenom = EXCLUDED.prenom,
          nationalite = EXCLUDED.nationalite,
          poste = EXCLUDED.poste,
          site_dep = EXCLUDED.site_dep,
          adresse_mail = EXCLUDED.adresse_mail,
          updated_at = CURRENT_TIMESTAMP
        $sql$,
        target_schema,
        left(coalesce(src.email, src.display_name, 'EMP-' || src.id::text), 50),
        coalesce(src.last_name, split_part(coalesce(src.display_name, ''), ' ', 1), 'UNKNOWN'),
        coalesce(src.first_name, split_part(coalesce(src.display_name, ''), ' ', 2), ''),
        coalesce(src.country, target_schema),
        coalesce(src.job_title, ''),
        coalesce(src.site, src.department, ''),
        src.email
      );
    END IF;
  END LOOP;
END $$;

COMMIT;
