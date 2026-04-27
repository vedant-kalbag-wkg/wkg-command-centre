-- Promote the seeded ETL automation actor to role='system' (unrestricted scope).

UPDATE "user"
SET role = 'system', updated_at = NOW()
WHERE id = '00000000-0000-0000-0000-000000000001';
