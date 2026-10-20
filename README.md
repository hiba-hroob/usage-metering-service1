# UsageMetering — Usage Tracking & Quota Management

A full-stack usage metering and quota management system built with **ASP.NET Core MVC, TypeScript, Fastify, and PostgreSQL**.

UsageMetering provides an API for tracking consumption and enforcing monthly account-level and user-level quotas, together with a web dashboard for managing workspaces, users, plans, and usage.

## Project Overview

UsageMetering helps applications control resource consumption through configurable plans and monthly quotas.

The project consists of two main application layers:

- **Web Dashboard:** An ASP.NET Core MVC application for interacting with the service through a browser.
- **REST API:** A TypeScript and Fastify application responsible for account authentication, plan management, quota enforcement, and usage tracking.

PostgreSQL stores account information, users, plans, monthly usage counters, and consumption history.

## Features

### Web Dashboard

- Workspace creation to establish an account for monitoring usage.
- User management and account-scoped usage administration.
- Consumption requests through the web interface.
- Plan management and custom plan creation.
- API Explorer for testing API endpoints.
- Usage and quota monitoring through the dashboard.
- Privacy Policy page documenting the service's data handling and security practices.
- Dark, neon-inspired interface designed for a consistent user experience.

### API & Usage Management

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
- Protected administrative endpoints for changing account and user plans.
- PostgreSQL migrations and seeded predefined plans.
- Docker Compose deployment and a runnable demonstration client.
- Integration tests using Vitest and a k6 performance test.

## Architecture

```text
                  User's Browser
                        |
                        v
             ASP.NET Core MVC Web App
                  UsageMetering.Web
                        |
                        | HTTP requests
                        v
                Fastify REST API
                 localhost:3000
                        |
                        v
                    PostgreSQL
```

**Responsibilities**

| Component | Responsibility |
|---|---|
| ASP.NET Core MVC | Web interface, dashboard pages, and HTTP requests to the API |
| TypeScript + Fastify | API endpoints, authentication, quota validation, and consumption processing |
| PostgreSQL | Persistent storage for accounts, users, plans, usage, and migrations |
| Docker Compose | Local infrastructure and API deployment |
| Vitest | Integration testing |
| Grafana k6 | Local API load testing |

The MVC application communicates with the API over HTTP. The API performs the actual usage and quota operations and persists data in PostgreSQL.

## Technology Stack

**Frontend / Web Application**
- ASP.NET Core MVC
- Razor Views
- HTML and CSS
- JavaScript

**Backend API**
- TypeScript
- Node.js
- Fastify
- PostgreSQL

**Development & Testing**
- Docker Compose
- npm
- Vitest
- Grafana k6

## Requirements

- Node.js 24 or a compatible supported LTS release.
- npm.
- .NET SDK compatible with the MVC project's target framework.
- Docker Desktop with Docker Compose.
- PowerShell on Windows, or a compatible terminal.

## Configuration & Security

The Docker Compose setup reads `ADMIN_API_KEY` from `.env`.

Create a random administration key in PowerShell from the project root:

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

The Docker Compose configuration uses demonstration database credentials and is intended for local development. Use secrets management, appropriate database credentials, and suitable access controls in production.

### API Configuration

The API listens on port `3000` by default in the documented local setup.

The MVC application must use the correct API base URL to communicate with the backend. For local development, the expected API address is:

```text
http://localhost:3000
```

Ensure that the MVC application's `UsageMeteringApi` HTTP client configuration points to the running API. Check the relevant configuration files in the web project if you use a different address or port.

Do not expose API keys or administrative credentials in public repositories, screenshots, or committed configuration files.

## Getting Started

### 1. Start PostgreSQL and the API

From the repository root, configure `.env` as described above, then run:

```powershell
docker compose up -d --build db app
```

Check the service status:

```powershell
docker compose ps
```

Check API health:

```powershell
Invoke-RestMethod http://localhost:3000/health
Invoke-RestMethod http://localhost:3000/health/db
```

The API listens on host port `3000`. PostgreSQL is published on host port `5433` and listens on port `5432` inside the Compose network. The Compose configuration runs the migration service as part of starting the application.

Both the API and the database must be available before creating workspaces through the web dashboard.

### 2. Start the Web Dashboard

Open a terminal and navigate to the MVC project directory:

```powershell
cd .\UsageMetering.Web
```

Restore dependencies and run the application:

```powershell
dotnet restore
dotnet run
```

Alternatively, open the solution in Visual Studio, select the MVC project as the startup project, and press `F5`.

Open the local URL printed by ASP.NET Core in the terminal or browser. The exact web port depends on the project's launch settings.

**Important:** Keep the API and database running while using the dashboard. Starting the MVC application does not automatically guarantee that the API or PostgreSQL is running.

### 3. Create a Workspace

1. Open the web dashboard in your browser.
2. Navigate to the workspace creation page.
3. Enter a workspace name.
4. Select **Create account**.
5. Use the resulting account to access account-scoped features supported by the application.

If workspace creation fails, verify the following:

- The API is running and listening on port `3000`.
- The API's database health endpoint responds successfully.
- The MVC application's configured API base URL is correct.
- The API and database logs do not contain connection or configuration errors.

Test API connectivity from PowerShell:

```powershell
Test-NetConnection localhost -Port 3000
```

A successful TCP connection reports:

```text
TcpTestSucceeded : True
```

This confirms that a service accepts connections on the port; it does not by itself confirm that the database is healthy or that account creation will succeed.

## Run with Docker Compose

Start the database and API:

```powershell
docker compose up -d --build db app
```

Run the demonstration client:

```powershell
docker compose run --build --rm demo
```

The demo creates an account with a custom shared monthly allowance of 15 units. It creates two users with different custom plans, consumes 8 units for the first user and 7 units for the second, and verifies that an additional unit is rejected with `ACCOUNT_MONTHLY_LIMIT`.

The demo then upgrades the account to Pro Account and the first user to Premium User, verifies that consumption can continue under the new plans without resetting existing usage, and prints a monthly usage summary.

### Expected Consumption Results

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

## Run Checks Locally

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

On Windows, `npm.cmd` can be used when PowerShell's execution policy prevents `npm.ps1` from running.

## Run Database Migrations

```powershell
npm.cmd run migrate
```

The migration command applies pending SQL migration files in sorted filename order and records applied migrations in `schema_migrations`.

Verify the database connection before running migrations. Ensure that the command targets the intended database. The migration files use PostgreSQL syntax.

## Predefined Plans

| Plan | Scope | Monthly allowance | Maximum units per request |
|---|---|---:|---:|
| Starter Account | Account | 10,000 | 100 |
| Pro Account | Account | 100,000 | 1,000 |
| Basic User | User | 1,000 | 20 |
| Premium User | User | 10,000 | 200 |

Account and user limits apply simultaneously. A request is accepted only if it passes both applicable per-request limits and both monthly quota checks.

Predefined plans are managed by the application and are read-only through the custom-plan endpoints. Account owners can create and update their own custom plans.

## API Endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/accounts` | Create an account and receive its API key |
| POST | `/accounts/me/users` | Create a user under the authenticated account |
| POST | `/consumptions` | Submit a consumption request |
| GET | `/usage` | Retrieve current-month account and user usage |
| GET | `/usage?month=YYYY-MM` | Retrieve usage for a specified UTC calendar month |
| GET | `/usage/history?page=1&limit=20` | Retrieve paginated account consumption history |
| GET | `/plans` | List predefined plans |
| GET | `/plans` with `x-api-key` | List predefined plans and the authenticated account's custom plans |
| POST | `/plans` | Create an account-owned custom plan |
| PATCH | `/plans/:planId` | Update an owned custom plan |
| PATCH | `/accounts/me/plan` | Assign an allowed account plan by `planId` |
| PATCH | `/accounts/me/users/:userId/plan` | Assign an allowed user plan by `planId` |
| PATCH | `/admin/accounts/:accountId/plan` | Change an account to a predefined plan |
| PATCH | `/admin/users/:userId/plan` | Change a user to a predefined plan |
| GET | `/health` | Check API health |
| GET | `/health/db` | Check database connectivity |

Account-scoped endpoints use the `x-api-key` header. Administrative plan-change endpoints use the `x-admin-api-key` header and require the configured `ADMIN_API_KEY`.

The web application's API Explorer can be used to test supported endpoints from the browser.

## API Key and Account Creation

Example account creation in PowerShell:

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

## Create a Custom Plan

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

## Submit a Consumption Request

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

Replace `USER_ID` with a user ID belonging to the authenticated account.

## Query Usage

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

An invalid month value, such as `2026-13`, returns HTTP 400. If `month` is omitted, the endpoint defaults to the current UTC calendar month.

Historical queries retrieve stored usage counters for the requested month. Plan names and quota values are based on the plans currently assigned to the account and users; the service does not snapshot historical plan definitions at the time of consumption.

## Quota and Request Behavior

- The quota period is the UTC calendar month.
- Both account-level and user-level request limits and monthly allowances apply to each consumption request.
- A rejected request does not increment monthly consumption counters.
- Accepted and rejected attempts are recorded in `usage_records`.
- `requestId` provides idempotency within an account.
- Repeating the same `requestId` with the same user and units does not consume units twice.
- Reusing a `requestId` with different request data returns HTTP 409.
- A user must belong to the account associated with the API key.
- Changing a plan affects future consumption decisions; it does not reset previous usage or delete consumption history.
- If usage already exceeds a newly assigned allowance, the reported remaining allowance is zero and subsequent requests are checked against the new limits.
- An account's monthly allowance is shared across its users.

## Data Model

| Table | Description |
|---|---|
| `accounts` | Account identity, API key hash, and account plan |
| `users` | Account-owned external user identities and user plans |
| `plans` | Predefined plan definitions and account-owned custom plan definitions |
| `monthly_usage` | Monthly consumption counters for accounts and individual users |
| `usage_records` | Accepted and rejected consumption attempts |
| `schema_migrations` | Migration history |

## Performance Test

A local performance test can be run using Grafana k6 in Docker.

Performance results depend on the application version, database state, workload, and machine resources. Historical local measurements are not production capacity guarantees; rerun the test after significant changes to refresh the report.

### Example Recorded Local Run

| Metric | Result |
|---|---:|
| HTTP requests | 4,135 |
| Completed consumption iterations | 4,133 |
| HTTP request failure rate | 0% |
| Checks | 100% passed |

The HTTP request total includes setup requests. These measurements were obtained in a local Docker environment and should not be interpreted as production capacity guarantees. Verify the figures against the corresponding test report before publishing them as recorded results.

### Run the Test

Run the following command from the project root:

```powershell
docker run --rm --mount "type=bind,source=$($PWD.Path),target=/work" -w /work grafana/k6 run --summary-export=performance/results.json performance/usage-load-test.js
```

Review the generated report before committing it. Performance artifacts must not expose raw API keys or other secrets.

## Assumptions and Limitations

- The service meters one resource type: units.
- Monthly periods use the UTC calendar month.
- Each request is accepted or rejected as a whole; partial consumption is not supported.
- The account API key authenticates the account, and consumption is restricted to users belonging to that account.
- Custom plans are private to their owning account.
- Historical summaries do not retain historical snapshots of plan definitions.
- The demo and seeded credentials are for local development only.
- Performance results should be rerun in the target environment and recorded with the test commands and load settings.

## Screenshots

Screenshots of the web dashboard can be added here to demonstrate the workspace creation flow, user management, plan management, consumption interface, and API Explorer.

Example structure:

```text
docs/
└── screenshots/
    ├── dashboard.png
    ├── users.png
    ├── plans.png
    ├── consume-usage.png
    └── api-explorer.png
```

After adding the images to the repository, embed them using Markdown, for example:

```markdown
![UsageMetering Dashboard](docs/screenshots/dashboard.png)
```

## License

Add the project's license information here if a license has been selected.
