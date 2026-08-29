-- Add pyq-archives to allowed vault_ids
ALTER TABLE vault_questions DROP CONSTRAINT IF EXISTS vault_questions_vault_id_check;
