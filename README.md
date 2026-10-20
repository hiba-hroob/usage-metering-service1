# Usage Metering and Quota Service

A TypeScript, Fastify, and PostgreSQL API for tracking consumption and enforcing monthly account-level and user-level quotas.

🌐**Live Web Application:**  [Open UsageMeter](https://usage-metering-service1.onrender.com/)

The web application is deployed and accessible online.

## Features

- API-key authentication with SHA-256 hashed API keys stored in PostgreSQL.
- Account-scoped users and usage data.
- Separate account and user plans with monthly allowances and per-request limits.
- Account-owned custom plans that can be created, updated, listed, and assigned by the owning account.
- Predefined plans that remain read-only through the custom-plan API.
- Account-scoped plan visibility: custom plans are not shared with unrelated accounts.
- Monthly usage summaries for the current UTC month or a requested month.
- Paginated consumption history, including accepted and rejected requests.
- Request idempotency using `requestId`.
- Transactional consumption processing with account locking for concurrent requests.
- Protected administrative endpoints for changing accounts' and users' plans.
- PostgreSQL migrations and seeded predefined plans.
- Docker Compose deployment and a runnable demonstration client.
- Integration tests using Vitest and a k6 performance test.

## Requirements

- Node.js 24 or a compatible supported LTS release.
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

The Docker Compose configuration uses demonstration database credentials and is intended for local development. Use secrets management, suitable access controls, and appropriate database credentials in production.

## Run with Docker Compose

Start the database and API:

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

The API listens on port `3000`. PostgreSQL is published on host port `5433` and listens on port `5432` inside the Compose network. The Compose configuration runs the migration service as part of starting the application.

### Run the demonstration client

```powershell
docker compose run --build --rm demo
```

The demo creates an account with a custom shared monthly allowance of 15 units. It creates two users with different custom plans, consumes 8 units for the first user and 7 units for the second, and verifies that an additional unit is rejected with `ACCOUNT_MONTHLY_LIMIT`.

The demo then upgrades the account to `Pro Account` and the first user to `Premium User`, verifies that consumption can continue under the new plans without resetting existing usage, and prints a monthly usage summary.

Expected consumption results:

| Stage | Account consumed | User 1 consumed | User 2 consumed |
|---|---:|---:|---:|
| User 1 consumes 8 units | 8 | 8 | 0 |
| User 2 consumes 7 units | 15 | 8 | 7 |
| An additional unit is rejected | 15 | 8 | 7 |
| User 1 consumes 21 units after the plan changes | 36 | 29 | 7 |

The additional unit is rejected because the shared account allowance has been reached, even though the second user still has remaining user-level allowance. Rejected requests are recorded but do not increment consumption counters.

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

Run the TypeScript type check:

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

The integration tests use a database named `usage_metering_test`. Configure `DB_NAME` and the other `DB_*` environment variables appropriately before running them. The test suite verifies the connected database name and refuses to proceed if it is not `usage_metering_test`.

### Run database migrations

```powershell
npm.cmd run migrate
```

The migration command applies pending SQL migration files in sorted filename order and records applied migrations in `schema_migrations`.

**Verify the database connection before running migrations.** Ensure that the command targets the intended database. The migration files use PostgreSQL syntax.

## Predefined plans

| Plan | Scope | Monthly allowance | Maximum units per request |
|---|---|---:|---:|
| Starter Account | Account | 10,000 | 100 |
| Pro Account | Account | 100,000 | 1,000 |
| Basic User | User | 1,000 | 20 |
| Premium User | User | 10,000 | 200 |

Account and user limits apply simultaneously. A request is accepted only if it passes both applicable per-request limits and both monthly quota checks.

Predefined plans are managed by the application and are read-only through the custom-plan endpoints. Account owners can create and update their own custom plans.

## API endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| `POST` | `/accounts` | Create an account and receive its API key |
| `POST` | `/accounts/me/users` | Create a user under the authenticated account |
| `POST` | `/consumptions` | Submit a consumption request |
| `GET` | `/usage` | Retrieve the current month's account and user usage |
| `GET` | `/usage?month=YYYY-MM` | Retrieve usage counters for a specified UTC calendar month |
| `GET` | `/usage/history?page=1&limit=20` | Retrieve paginated account consumption history |
| `GET` | `/plans` | List predefined plans |
| `GET` | `/plans` with `x-api-key` | List predefined plans and the authenticated account's custom plans |
| `POST` | `/plans` | Create a custom plan owned by the authenticated account |
| `PATCH` | `/plans/:planId` | Update an owned custom plan |
| `PATCH` | `/accounts/me/plan` | Assign an allowed account plan by `planId` |
| `PATCH` | `/accounts/me/users/:userId/plan` | Assign an allowed user plan by `planId` |
| `PATCH` | `/admin/accounts/:accountId/plan` | Change an account to a predefined plan |
| `PATCH` | `/admin/users/:userId/plan` | Change a user to a predefined plan |
| `GET` | `/health` | Check API health |
| `GET` | `/health/db` | Check database connectivity |

Account-scoped endpoints use the `x-api-key` header. Administrative plan-change endpoints use the `x-admin-api-key` header. Administrative operations require the configured `ADMIN_API_KEY`.

### API key and account creation

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

Keep the returned `apiKey` private. The database stores a SHA-256 hash of the account API key rather than its raw value.

### Create a custom plan

Custom plans belong to the account authenticated by `x-api-key`. The scope must be `account` or `user`, and both quota values must be positive whole numbers.

Example user-plan creation:

```powershell
$customPlan = Invoke-RestMethod `
  -Method Post `
  -Uri 'http://localhost:3000/plans' `
  -Headers @{ 'x-api-key' = $account.apiKey } `
  -ContentType 'application/json' `
  -Body (@{
    name = 'Example Custom User'
    scope = 'user'
    monthlyAllowance = 500
    maxUnitsPerRequest = 50
  } | ConvertTo-Json)
```

The returned `plan.id` can be used to assign the plan to a user within the authenticated account:

```powershell
Invoke-RestMethod `
  -Method Patch `
  -Uri "http://localhost:3000/accounts/me/users/USER_ID/plan" `
  -Headers @{ 'x-api-key' = $account.apiKey } `
  -ContentType 'application/json' `
  -Body (@{
    planId = $customPlan.plan.id
  } | ConvertTo-Json)
```

Replace `USER_ID` with the actual user ID returned when creating the user.

An account can assign its own custom plans and applicable predefined plans. It cannot assign another account's custom plans. Custom-plan updates are restricted to their owning account; attempts to update predefined plans through `PATCH /plans/:planId` are not allowed.

### Submit a consumption request

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri 'http://localhost:3000/consumptions' `
  -Headers @{ 'x-api-key' = $account.apiKey } `
  -ContentType 'application/json' `
  -Body (@{
    userId = 'USER_ID'
    units = 5
    requestId = [guid]::NewGuid().ToString()
  } | ConvertTo-Json)
```

Replace `USER_ID` with a user ID belonging to the authenticated account. In this example, `USER_ID` is a placeholder string and must be replaced before executing the request.

### Query usage for a previous month

Retrieve the current month's summary:

```powershell
Invoke-RestMethod `
  -Uri 'http://localhost:3000/usage' `
  -Headers @{ 'x-api-key' = $account.apiKey }
```

Retrieve a specific month using the `YYYY-MM` format:

```powershell
Invoke-RestMethod `
  -Uri 'http://localhost:3000/usage?month=2026-09' `
  -Headers @{ 'x-api-key' = $account.apiKey }
```

An invalid month value, such as `2026-13`, returns HTTP `400`. If `month` is omitted, the endpoint defaults to the current UTC calendar month.

Historical queries retrieve the stored usage counters for the requested month. **Plan names and quota values are based on the plans currently assigned to the account and users; the service does not snapshot historical plan definitions at the time of consumption.**

## Quota and request behavior

- The quota period is the UTC calendar month.
- Both account-level and user-level request limits and monthly allowances apply to each consumption request.
- A rejected request does not increment monthly consumption counters.
- Accepted and rejected attempts are recorded in `usage_records`.
- `requestId` provides idempotency within an account.
- Repeating the same `requestId` with the same user and units does not consume units twice.
- Reusing a `requestId` with different request data returns HTTP `409`.
- A user must belong to the account associated with the API key.
- Changing a plan affects future consumption decisions; it does not reset previous usage or delete consumption history.
- If usage already exceeds a newly assigned allowance, the reported remaining allowance is zero and subsequent requests are checked against the new limits.
- An account's monthly allowance is shared across its users.

## Data model

- `accounts`: account identity, API key hash, and account plan.
- `users`: account-owned external user identities and user plans.
- `plans`: predefined plan definitions and account-owned custom plan definitions.
- `monthly_usage`: monthly consumption counters for accounts and individual users.
- `usage_records`: accepted and rejected consumption attempts.
- `schema_migrations`: migration history.

## Performance test

A local performance test can be run using Grafana k6 in Docker.

Performance results depend on the application version, database state, workload, and machine resources. Historical local measurements are not production capacity guarantees; rerun the test after significant changes to refresh the report.

### Example recorded local run

| Metric | Result |
|---|---:|
| HTTP requests | 4,135 |
| Completed consumption iterations | 4,133 |
| HTTP request failure rate | 0% |
| Checks | 100% passed |

The HTTP request total includes setup requests. These measurements were obtained in a local Docker environment and should not be interpreted as production capacity guarantees. Verify these figures against the corresponding test report before publishing them as recorded results.

### Run the test

Run the following command from the project root:

```powershell
docker run --rm --mount "type=bind,source=$($PWD.Path),target=/work" -w /work grafana/k6 run --summary-export=performance/results.json performance/usage-load-test.js
```

Review the generated report before committing it. Performance artifacts must not expose raw API keys or other secrets.

## Assumptions and limitations

- The service meters one resource type: units.
- Monthly periods use the UTC calendar month.
- Each request is accepted or rejected as a whole; partial consumption is not supported.
- The account API key authenticates the account, and consumption is restricted to users belonging to that account.
- Custom plans are private to their owning account.
- Historical summaries do not retain historical snapshots of plan definitions.
- The demo and seeded credentials are for local development only.
- Performance results should be rerun in the target environment and recorded with the test commands and load settings.

## Web Application and User Interface

The project also includes an ASP.NET Core MVC web application that provides a browser-based interface for interacting with the Usage Metering API.

## Live Deployment

The UsageMeter web application is deployed on Render and available online:

**Live URL:** https://usage-metering-service1.onrender.com/

Visit the live application to explore the dashboard, workspace management, user management, usage consumption, plans, and API Explorer through the browser-based interface.

The web application communicates with the Usage Metering REST API to provide account-level and user-level usage monitoring and quota management.

### Web Application Features

- **Dashboard:** A central interface for accessing the main application features and viewing usage-related information.
- **Workspace Management:** Create a workspace (account) and connect the web application to the API.
- **Users:** Manage users associated with the authenticated account.
- **Usage Consumption:** Submit consumption requests and interact with the usage tracking functionality.
- **Plans:** View available plans and work with account-owned custom plans.
- **API Explorer:** Explore and interact with the API through the web interface.
- **Privacy Policy:** A dedicated page describing privacy and data-handling practices.

### Technology Stack

| Technology | Purpose |
|---|---|
| C# | Web application development |
| ASP.NET Core MVC | Server-side web application framework and MVC architecture |
| Razor Views | Rendering dynamic HTML pages |
| HTML5 | Web page structure |
| CSS3 | Styling, layout, responsive design, and visual effects |
| JavaScript | Client-side interactions where implemented |
| TypeScript | API implementation |
| Fastify | API routing and HTTP request handling |
| PostgreSQL | Persistent data storage |

### Architecture

The web application and API are separate application components. The MVC application communicates with the REST API over HTTP, while the API handles business logic, quota enforcement, authentication, and database operations.

```text
User's Browser
      |
      v
ASP.NET Core MVC Web Application
      |
      | HTTP requests
      v
TypeScript + Fastify REST API
      |
      v
PostgreSQL Database
```

### User Interface Design

The web interface uses a dark, modern visual style with neon-inspired cyan, pink, and green accents. Its pages are organized around the main usage-metering workflows, making account access, user management, plan management, consumption, and API exploration available through a unified interface.

The MVC web application complements the REST API by providing a graphical way to interact with its functionality, while the API remains responsible for enforcing account isolation, authentication, and usage quotas.
