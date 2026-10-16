import {
    afterAll,
    beforeAll,
    describe,
    expect,
    it,
} from "vitest";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { randomUUID } from "node:crypto";

let app: FastifyInstance | undefined;
let pool: Pool | undefined;

const accountMonthlyPlan = "Integration Account Monthly Limit";
const userMonthlyPlan = "Integration User Monthly Limit";
const lowAllowanceUserPlan = "Integration User Low Allowance";

beforeAll(async () => {
    // Select the test database before importing the application.
    process.env.DB_NAME = "usage_metering_test";
    process.env.ADMIN_API_KEY = "integration-test-admin-key";

    const [{ app: realApp }, { pool: dbPool }] = await Promise.all([
        import("./index.js"),
        import("./db.js"),
    ]);

    app = realApp;
    pool = dbPool;

    // Never run integration tests against the development database.
    const result = await dbPool.query(
        "SELECT current_database() AS database_name",
    );

    const databaseName = result.rows[0]?.database_name;

    if (databaseName !== "usage_metering_test") {
        throw new Error(
            `Test safety check failed: connected to ${String(databaseName)}`,
        );
    }

    // These plans are created only after the database safety check.
    await dbPool.query(
        `INSERT INTO plans
        (name, scope, monthly_allowance, max_units_per_request)
     VALUES
        ($1, 'account', 10, 100),
        ($2, 'user', 10, 20),
        ($3, 'user', 4, 20)
     ON CONFLICT (name) DO UPDATE SET
        scope = EXCLUDED.scope,
        monthly_allowance = EXCLUDED.monthly_allowance,
        max_units_per_request = EXCLUDED.max_units_per_request`,
        [accountMonthlyPlan, userMonthlyPlan, lowAllowanceUserPlan],
    );

    await realApp.ready();
});

afterAll(async () => {
    if (app) {
        await app.close();
    }

    if (pool) {
        await pool.end();
    }
});

function getApp(): FastifyInstance {
    if (!app) {
        throw new Error("Test application is not initialized.");
    }

    return app;
}

async function createAccount(
    planName = "Starter Account",
): Promise<string> {
    const response = await getApp().inject({
        method: "POST",
        url: "/accounts",
        payload: {
            name: `integration-test-${randomUUID()}`,
            planName,
        },
    });

    expect(response.statusCode).toBe(201);

    const body = response.json() as { apiKey?: unknown };

    if (typeof body.apiKey !== "string") {
        throw new Error("Account creation did not return an API key.");
    }

    return body.apiKey;
}

async function createUser(
    apiKey: string,
    planName = "Basic User",
): Promise<number> {
    const response = await getApp().inject({
        method: "POST",
        url: "/accounts/me/users",
        headers: { "x-api-key": apiKey },
        payload: {
            externalUserId: `user-${randomUUID()}`,
            planName,
        },
    });

    expect(response.statusCode).toBe(201);

    const body = response.json() as {
        user?: { id?: unknown };
    };

    const id = body.user?.id;

    if (
        typeof id !== "string" &&
        typeof id !== "number"
    ) {
        throw new Error("User creation did not return a user ID.");
    }

    return Number(id);
}

async function consume(
    apiKey: string,
    userId: number,
    units: number,
    requestId: string = randomUUID(),
) {
    return getApp().inject({
        method: "POST",
        url: "/consumptions",
        headers: { "x-api-key": apiKey },
        payload: { userId, units, requestId },
    });
}

describe("Usage metering API integration tests", () => {
    it("rejects a missing API key", async () => {
        const response = await getApp().inject({
            method: "GET",
            url: "/usage/history",
        });

        expect(response.statusCode).toBe(401);
    });

    it("rejects an invalid API key", async () => {
        const response = await getApp().inject({
            method: "GET",
            url: "/usage/history",
            headers: {
                "x-api-key": "invalid-integration-test-key",
            },
        });

        expect(response.statusCode).toBe(401);
    });

    it("creates an account and retrieves its history", async () => {
        const apiKey = await createAccount();

        const response = await getApp().inject({
            method: "GET",
            url: "/usage/history?page=1&limit=10",
            headers: { "x-api-key": apiKey },
        });

        expect(response.statusCode).toBe(200);

        const history = response.json() as {
            page: number;
            limit: number;
            records: unknown[];
        };

        expect(history.page).toBe(1);
        expect(history.limit).toBe(10);
        expect(Array.isArray(history.records)).toBe(true);
    });

    it("rejects usage above the user request limit without consuming units", async () => {
        const apiKey = await createAccount();
        const userId = await createUser(apiKey);

        // Basic User allows at most 20 units per request.
        const response = await consume(apiKey, userId, 21);

        expect(response.statusCode).toBe(200);

        const body = response.json();

        expect(body.accepted).toBe(false);
        expect(body.reason).toBe("USER_REQUEST_LIMIT");
        expect(body.accountUsage.consumed).toBe(0);
        expect(body.userUsage.consumed).toBe(0);
    });

    it("rejects usage above the account request limit without consuming units", async () => {
        const apiKey = await createAccount();
        const userId = await createUser(apiKey);

        // Starter Account allows at most 100 units per request.
        const response = await consume(apiKey, userId, 101);

        expect(response.statusCode).toBe(200);

        const body = response.json();

        expect(body.accepted).toBe(false);
        expect(body.reason).toBe("ACCOUNT_REQUEST_LIMIT");
        expect(body.accountUsage.consumed).toBe(0);
        expect(body.userUsage.consumed).toBe(0);
    });

    it("enforces the account monthly allowance", async () => {
        const apiKey = await createAccount(accountMonthlyPlan);
        const userId = await createUser(apiKey);

        const first = await consume(apiKey, userId, 6);
        expect(first.json().accepted).toBe(true);

        const second = await consume(apiKey, userId, 6);

        expect(second.statusCode).toBe(200);

        const body = second.json();

        expect(body.accepted).toBe(false);
        expect(body.reason).toBe("ACCOUNT_MONTHLY_LIMIT");
        expect(body.accountUsage.consumed).toBe(6);
        expect(body.userUsage.consumed).toBe(6);
    });

    it("enforces the user monthly allowance", async () => {
        const apiKey = await createAccount();
        const userId = await createUser(apiKey, userMonthlyPlan);

        const first = await consume(apiKey, userId, 6);
        expect(first.json().accepted).toBe(true);

        const second = await consume(apiKey, userId, 6);

        expect(second.statusCode).toBe(200);

        const body = second.json();

        expect(body.accepted).toBe(false);
        expect(body.reason).toBe("USER_MONTHLY_LIMIT");
        expect(body.accountUsage.consumed).toBe(6);
        expect(body.userUsage.consumed).toBe(6);
    });

    it("prevents one account from consuming another account's user's quota", async () => {
        const accountAKey = await createAccount();
        const accountAUserId = await createUser(accountAKey);

        const validConsumption = await consume(
            accountAKey,
            accountAUserId,
            5,
        );

        expect(validConsumption.json().accepted).toBe(true);

        const accountBKey = await createAccount();

        const crossAccountAttempt = await consume(
            accountBKey,
            accountAUserId,
            5,
        );

        expect(crossAccountAttempt.statusCode).toBe(404);

        const accountBHistory = await getApp().inject({
            method: "GET",
            url: "/usage/history?page=1&limit=10",
            headers: { "x-api-key": accountBKey },
        });

        expect(accountBHistory.statusCode).toBe(200);

        const history = accountBHistory.json() as {
            total: number;
            records: unknown[];
        };

        expect(history.total).toBe(0);
        expect(history.records).toHaveLength(0);
    });

    it("does not consume units twice when a request is replayed", async () => {
        const apiKey = await createAccount();
        const userId = await createUser(apiKey);
        const requestId = `retry-${randomUUID()}`;

        const first = await consume(apiKey, userId, 5, requestId);
        expect(first.json().accepted).toBe(true);

        const replay = await consume(apiKey, userId, 5, requestId);

        expect(replay.statusCode).toBe(200);
        expect(replay.json().replayed).toBe(true);
        expect(replay.json().accepted).toBe(true);

        const conflictingReplay = await consume(
            apiKey,
            userId,
            6,
            requestId,
        );

        expect(conflictingReplay.statusCode).toBe(409);

        const historyResponse = await getApp().inject({
            method: "GET",
            url: "/usage/history?page=1&limit=10",
            headers: { "x-api-key": apiKey },
        });

        const history = historyResponse.json() as {
            total: number;
        };

        // The replay must not create a second usage record.
        expect(history.total).toBe(1);
    });

    it("rejects plan changes without an admin key", async () => {
        const response = await getApp().inject({
            method: "PATCH",
            url: "/admin/users/1/plan",
            payload: {
                planName: "Premium User",
            },
        });

        expect(response.statusCode).toBe(401);
        expect(response.json().error).toBe("Missing admin API key");
    });

    it("rejects plan changes with an invalid admin key", async () => {
        const response = await getApp().inject({
            method: "PATCH",
            url: "/admin/users/1/plan",
            headers: {
                "x-admin-api-key": "wrong-test-admin-key",
            },
            payload: {
                planName: "Premium User",
            },
        });

        expect(response.statusCode).toBe(401);
        expect(response.json().error).toBe("Invalid admin API key");
    });

    it("changes a user's plan without resetting previous usage", async () => {
        const apiKey = await createAccount();
        const userId = await createUser(apiKey);

        const first = await consume(apiKey, userId, 5);

        expect(first.statusCode).toBe(200);
        expect(first.json().accepted).toBe(true);
        expect(first.json().userUsage.consumed).toBe(5);

        const changeResponse = await getApp().inject({
            method: "PATCH",
            url: `/admin/users/${userId}/plan`,
            headers: {
                "x-admin-api-key": "integration-test-admin-key",
            },
            payload: {
                planName: "Premium User",
            },
        });

        expect(changeResponse.statusCode).toBe(200);
        expect(changeResponse.json().user.planName).toBe("Premium User");

        const second = await consume(apiKey, userId, 21);

        expect(second.statusCode).toBe(200);

        const result = second.json();

        expect(result.accepted).toBe(true);
        expect(result.accountUsage.consumed).toBe(26);
        expect(result.userUsage.consumed).toBe(26);

        const historyResponse = await getApp().inject({
            method: "GET",
            url: "/usage/history?page=1&limit=10",
            headers: {
                "x-api-key": apiKey,
            },
        });

        expect(historyResponse.statusCode).toBe(200);

        const history = historyResponse.json() as {
            total: number;
            records: Array<{
                units: number;
                accepted: boolean;
            }>;
        };

        expect(history.total).toBe(2);
        expect(
            history.records.some(
                (record) => record.units === 5 && record.accepted,
            ),
        ).toBe(true);
    });

    it("does not exceed the account allowance under concurrent requests", async () => {
        const apiKey = await createAccount(accountMonthlyPlan);
        const userId = await createUser(apiKey);

        // Send 10 requests concurrently; each requests 3 units.
        const responses = await Promise.all(
            Array.from({ length: 10 }, () =>
                consume(apiKey, userId, 3),
            ),
        );

        expect(responses.every((response) => response.statusCode === 200))
            .toBe(true);

        const results = responses.map((response) =>
            response.json() as {
                accepted: boolean;
                reason: string | null;
            },
        );

        const accepted = results.filter((result) => result.accepted);
        const rejected = results.filter((result) => !result.accepted);

        expect(accepted).toHaveLength(3);
        expect(rejected).toHaveLength(7);

        expect(
            rejected.every(
                (result) => result.reason === "ACCOUNT_MONTHLY_LIMIT",
            ),
        ).toBe(true);

        const usageResponse = await getApp().inject({
            method: "GET",
            url: "/usage",
            headers: { "x-api-key": apiKey },
        });

        expect(usageResponse.statusCode).toBe(200);

        const usage = usageResponse.json() as {
            account: { consumed: number };
            users: Array<{ id: number; consumed: number }>;
        };

        const userUsage = usage.users.find((item) => item.id === userId);

        expect(usage.account.consumed).toBe(9);
        expect(userUsage?.consumed).toBe(9);
    });


    it("blocks usage when a downgraded plan allowance is below existing consumption", async () => {
        const apiKey = await createAccount();
        const userId = await createUser(apiKey, "Premium User");

        const first = await consume(apiKey, userId, 5);

        expect(first.statusCode).toBe(200);
        expect(first.json().accepted).toBe(true);

        const changeResponse = await getApp().inject({
            method: "PATCH",
            url: `/admin/users/${userId}/plan`,
            headers: {
                "x-admin-api-key": "integration-test-admin-key",
            },
            payload: {
                planName: lowAllowanceUserPlan,
            },
        });

        expect(changeResponse.statusCode).toBe(200);
        expect(changeResponse.json().user.planName).toBe(
            lowAllowanceUserPlan,
        );

        const blocked = await consume(apiKey, userId, 1);

        expect(blocked.statusCode).toBe(200);

        const result = blocked.json();

        expect(result.accepted).toBe(false);
        expect(result.reason).toBe("USER_MONTHLY_LIMIT");
        expect(result.userUsage.consumed).toBe(5);
    });


    it("changes an account's plan without resetting usage and applies new request limits", async () => {
        const accountResponse = await getApp().inject({
            method: "POST",
            url: "/accounts",
            payload: {
                name: `integration-test-${randomUUID()}`,
                planName: "Starter Account",
            },
        });

        expect(accountResponse.statusCode).toBe(201);

        const createdBody = accountResponse.json() as {
            account?: { id?: unknown };
            apiKey?: unknown;
        };

        const accountId = createdBody.account?.id;

        if (
            (typeof accountId !== "number" &&
                typeof accountId !== "string") ||
            typeof createdBody.apiKey !== "string"
        ) {
            throw new Error("Account creation did not return its ID and API key.");
        }

        const apiKey = createdBody.apiKey;
        const userId = await createUser(apiKey, "Premium User");

        const first = await consume(apiKey, userId, 10);

        expect(first.json().accepted).toBe(true);
        expect(first.json().accountUsage.consumed).toBe(10);

        const blocked = await consume(apiKey, userId, 101);

        expect(blocked.statusCode).toBe(200);
        expect(blocked.json().accepted).toBe(false);
        expect(blocked.json().reason).toBe("ACCOUNT_REQUEST_LIMIT");
        expect(blocked.json().accountUsage.consumed).toBe(10);

        const changeResponse = await getApp().inject({
            method: "PATCH",
            url: `/admin/accounts/${Number(accountId)}/plan`,
            headers: {
                "x-admin-api-key": "integration-test-admin-key",
            },
            payload: {
                planName: "Pro Account",
            },
        });

        expect(changeResponse.statusCode).toBe(200);
        expect(changeResponse.json().account.planName).toBe("Pro Account");

        const afterUpgrade = await consume(apiKey, userId, 101);

        expect(afterUpgrade.statusCode).toBe(200);
        expect(afterUpgrade.json().accepted).toBe(true);
        expect(afterUpgrade.json().accountUsage.consumed).toBe(111);
        expect(afterUpgrade.json().userUsage.consumed).toBe(111);
    });


});