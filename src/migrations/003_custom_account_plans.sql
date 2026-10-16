ALTER TABLE plans
    ADD COLUMN IF NOT EXISTS owner_account_id BIGINT
    REFERENCES accounts(id);

ALTER TABLE plans
    DROP CONSTRAINT IF EXISTS plans_name_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_predefined_plan_name_scope
    ON plans (name, scope)
    WHERE owner_account_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_custom_plan_owner_name_scope
    ON plans (owner_account_id, name, scope)
    WHERE owner_account_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_plans_owner_account_id
    ON plans (owner_account_id);