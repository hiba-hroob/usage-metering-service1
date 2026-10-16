
# Usage Metering and Quota Service

A TypeScript, Fastify, and PostgreSQL API for tracking unit consumption and enforcing monthly account and user quotas.

## Features

- API-key authentication for accounts.
- Users belong to a specific account.
- Separate account-level and user-level plans.
- Monthly quotas based on the UTC calendar month.
- Per-request unit limits.
- Rejected consumption attempts are logged without consuming quota.
- Request idempotency using `requestId`.
- Account-scoped usage summaries and paginated history.
- Protected administrative endpoints for changing plans.
- Database migrations and seeded plans.
- Docker Compose deployment and a runnable demo client.
- Integration tests using Vitest.

## Requirements

- Node.js 24 or compatible LTS release.
- npm.
- Docker Desktop with Docker Compose.

## Configuration

The Docker Compose setup reads `ADMIN_API_KEY` from `.env`.

Create a random administration key in PowerShell:

```powershell
$bytes = New-Object byte[] 32
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$rng.GetBytes($bytes)
$rng.Dispose()
$adminKey = [Convert]::ToBase64String($bytes)
"ADMIN_API_KEY=$adminKey" | Set-Content -Path .\.env -Encoding ascii
Remove-Variable adminKey, bytes, rng
```

Do not commit `.env` or expose the administration key. The repository's `.gitignore` excludes `.env`.

The current Docker Compose file uses demonstration database credentials and is intended for local development. Use secrets management and appropriate access controls in production.

## Run with Docker Compose

Start the database, apply migrations, and start the API:

```powershell
docker compose up -d --build db app
```

Check service status:

```powershell
docker compose ps
```

Check API health:

```powershell
Invoke-RestMethod http://localhost:3000/health
Invoke-RestMethod http://localhost:3000/health/db
```

The API listens on port `3000`. PostgreSQL is published on host port `5433` and listens on port `5432` inside the Compose network.

Run the example client:

```powershell
docker compose run --rm --build demo
```

The demo creates an account and user, demonstrates an accepted request, user-level and account-level request-limit rejections, changes the user's plan, and retries with the upgraded plan. The expected final consumed usage in this demo is 26 units for both the account and user.

Stop the services:

```powershell
docker compose down
```

The named database volume is preserved by `docker compose down`. Do not use `docker compose down -v` unless you intentionally want to delete the Compose database volume.

## Run checks locally

Install dependencies:

```powershell
npm.cmd ci
```

Type-check the source:

```powershell
npm.cmd run typecheck
```

Build the production JavaScript:

```powershell
npm.cmd run build
```

Run integration tests:

```powershell
npm.cmd test
```

The integration tests use a database named `usage_metering_test`. Configure `DB_NAME` and the other `DB_*` environment variables appropriately before running them. The test suite checks the connected database name and refuses to proceed if it is not `usage_metering_test`.

Run database migrations:

```powershell
npm.cmd run migrate
```

The migration command applies pending SQL migration files in sorted filename order and records applied migrations in `schema_migrations`. Ensure the database connection points to the intended database before running migrations.

## Seeded plans

| Plan | Scope | Monthly allowance | Maximum units per request |
|---|---|---:|---:|
| Starter Account | Account | 10,000 | 100 |
| Pro Account | Account | 100,000 | 1,000 |
| Basic User | User | 1,000 | 20 |
| Premium User | User | 10,000 | 200 |

The account and user quotas both apply. A consumption request is accepted only when it passes all applicable request-size and monthly quota limits.

## API endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| `POST` | `/accounts` | Create an account and receive its API key |
| `POST` | `/accounts/me/users` | Create a user under the authenticated account |
| `POST` | `/consumptions` | Submit a consumption request |
| `GET` | `/usage` | Retrieve account and user usage |
| `GET` | `/usage/history?page=1&limit=20` | Retrieve paginated account history |
| `GET` | `/plans` | List available plans |
| `PATCH` | `/admin/accounts/:accountId/plan` | Change an account plan |
| `PATCH` | `/admin/users/:userId/plan` | Change a user plan |
| `GET` | `/health` | Check API health |
| `GET` | `/health/db` | Check database connectivity |

Account-scoped routes use the `x-api-key` header. Administrative plan-change routes use the `x-admin-api-key` header. Plan changes require the configured `ADMIN_API_KEY`.

Example account creation:

```powershell
$account = Invoke-RestMethod `
  -Method Post `
  -Uri 'http://localhost:3000/accounts' `
  -ContentType 'application/json' `
  -Body (@{
    name = 'Example Company'
    planName = 'Starter Account'
  } | ConvertTo-Json)
```

Keep the returned `apiKey` private. The database stores a SHA-256 hash of the account API key rather than the raw key.

Example consumption request:

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri 'http://localhost:3000/consumptions' `
  -Headers @{ 'x-api-key' = $account.apiKey } `
  -ContentType 'application/json' `
  -Body (@{
    userId = 1
    units = 5
    requestId = [guid]::NewGuid().ToString()
  } | ConvertTo-Json)
```

Use the actual `userId` returned when creating a user under that account.

## Quota and request behavior

- The quota period is the UTC calendar month.
- Both account-level and user-level rules apply to each consumption request.
- Rejected attempts are recorded and do not increment usage counters.
- `requestId` provides idempotency within an account.
- Retrying the same `requestId` with the same user and units does not consume units again.
- Reusing a `requestId` with different request data returns a conflict.
- Changing a plan affects future consumption decisions; it does not reset previous usage or delete history.
- If a plan is lowered below the current usage, the remaining allowance is reported as zero and subsequent requests are subject to the new limits.

## Data model

- `accounts`: account identity, API key hash, and account plan.
- `users`: account-owned external user identities and user plans.
- `plans`: account and user plan definitions.
- `monthly_usage`: monthly counters for accounts and users.
- `usage_records`: accepted and rejected consumption attempts.
- `schema_migrations`: applied database migration history.

## Assumptions and limitations

- The service meters one resource type: units.
- Monthly periods use the UTC calendar month.
- Each request is accepted or rejected as a whole; partial consumption is not supported.
- An account API key authenticates the account, and consumption can only be submitted for a user belonging to that account.
- The demo and seeded credentials are for local development only.
- Performance results should be measured in the target environment and recorded with the test commands and load settings; do not treat local results as production guarantees.
## Performance test

A local performance test was executed using Grafana k6 in Docker.

### Test configuration

- Maximum virtual users: 2
- Test duration: 25 seconds, excluding setup
- Workload: repeated consumption requests of 1 unit
- Account plan: Pro Account
- User plan: Premium User

### Measured results

| Metric | Result |
|---|---:|
| HTTP requests | 3,986 |
| Completed consumption iterations | 3,984 |
| Request rate | 159.15 requests/second |
| Average HTTP request duration | 10.44 ms |
| Median HTTP request duration | 9.51 ms |
| p90 HTTP request duration | 15.57 ms |
| p95 HTTP request duration | 19.13 ms |
| Maximum HTTP request duration | 87.74 ms |
| HTTP request failure rate | 0% |
| Checks passed | 7,968 |
| Checks failed | 0 |

The HTTP request total includes the two setup requests used to create
the test account and user. The results are from a local Docker
environment and should not be interpreted as production capacity guarantees.

### Run the test

```powershell
docker run --rm --mount "type=bind,source=$($PWD.Path),target=/work" -w /work grafana/k6 run --summary-export=performance/results.json performance/usage-load-test.js