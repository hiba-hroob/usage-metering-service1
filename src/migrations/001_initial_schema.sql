
CREATE TABLE IF NOT EXISTS plans (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    scope VARCHAR(20) NOT NULL
        CHECK (scope IN ('account', 'user')),
    monthly_allowance BIGINT NOT NULL
        CHECK (monthly_allowance >= 0),
    max_units_per_request BIGINT NOT NULL
        CHECK (max_units_per_request > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS accounts (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    api_key_hash TEXT NOT NULL UNIQUE,
    plan_id BIGINT NOT NULL REFERENCES plans(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    account_id BIGINT NOT NULL REFERENCES accounts(id),
    external_user_id VARCHAR(150) NOT NULL,
    plan_id BIGINT NOT NULL REFERENCES plans(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (account_id, external_user_id),
    UNIQUE (account_id, id)
);

CREATE TABLE IF NOT EXISTS usage_records (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    account_id BIGINT NOT NULL REFERENCES accounts(id),
    user_id BIGINT NOT NULL,
    request_id VARCHAR(150) NOT NULL,
    units BIGINT NOT NULL CHECK (units > 0),
    accepted BOOLEAN NOT NULL,
    reason VARCHAR(50),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    FOREIGN KEY (account_id, user_id)
        REFERENCES users(account_id, id),

    UNIQUE (account_id, request_id)
);

CREATE INDEX IF NOT EXISTS idx_usage_records_account_created
    ON usage_records (account_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_usage_records_user_created
    ON usage_records (account_id, user_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS monthly_usage (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    account_id BIGINT NOT NULL REFERENCES accounts(id),
    user_id BIGINT,
    month_start DATE NOT NULL,
    units_consumed BIGINT NOT NULL DEFAULT 0
        CHECK (units_consumed >= 0),

    FOREIGN KEY (account_id, user_id)
        REFERENCES users(account_id, id),

    CHECK (EXTRACT(DAY FROM month_start) = 1),

    UNIQUE NULLS NOT DISTINCT (account_id, user_id, month_start)
);
