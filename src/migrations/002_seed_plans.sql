
INSERT INTO plans (
    name,
    scope,
    monthly_allowance,
    max_units_per_request
)
VALUES
    ('Starter Account', 'account', 10000, 100),
    ('Pro Account', 'account', 100000, 1000),
    ('Basic User', 'user', 1000, 20),
    ('Premium User', 'user', 10000, 200)
ON CONFLICT (name) DO UPDATE SET
    scope = EXCLUDED.scope,
    monthly_allowance = EXCLUDED.monthly_allowance,
    max_units_per_request = EXCLUDED.max_units_per_request;
