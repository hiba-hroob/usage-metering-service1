
import { randomUUID } from "node:crypto";

const baseUrl = (
    process.env.API_BASE_URL ?? "http://localhost:3000"
).replace(/\/$/, "");

const adminApiKey = process.env.ADMIN_API_KEY;

type ConsumptionResult = {
    accepted: boolean;
    reason: string | null;
    accountUsage: {
        consumed: number;
        allowance: number;
        maxUnitsPerRequest: number;
    };
    userUsage: {
        consumed: number;
        allowance: number;
        maxUnitsPerRequest: number;
    };
};

type CreatedAccount = {
    account: { id: number | string };
    apiKey: string;
};

type CreatedUser = {
    user: { id: number | string };
};

async function waitForService(): Promise<void> {
    for (let attempt = 1; attempt <= 30; attempt++) {
        try {
            const response = await fetch(`${baseUrl}/health/db`);

            if (response.ok) {
                console.log("Service and database are ready.");
                return;
            }
        } catch {
            // The service may still be starting.
        }

        await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    throw new Error("Service did not become ready within 30 seconds.");
}

async function apiRequest<T>(
    path: string,
    options: {
        method?: string;
        apiKey?: string;
        adminKey?: string;
        body?: unknown;
    } = {},
): Promise<T> {
    const headers: Record<string, string> = {};

    if (options.apiKey) {
        headers["x-api-key"] = options.apiKey;
    }

    if (options.adminKey) {
        headers["x-admin-api-key"] = options.adminKey;
    }

    if (options.body !== undefined) {
        headers["content-type"] = "application/json";
    }

    const response = await fetch(`${baseUrl}${path}`, {
        method: options.method ?? "GET",
        headers,
        ...(options.body !== undefined
            ? { body: JSON.stringify(options.body) }
            : {}),
    });

    const text = await response.text();
    let data: unknown;

    try {
        data = text ? JSON.parse(text) : {};
    } catch {
        data = text;
    }

    if (!response.ok) {
        const errorMessage =
            typeof data === "object" &&
                data !== null &&
                "error" in data
                ? String(data.error)
                : response.statusText;

        throw new Error(
            `${options.method ?? "GET"} ${path}: HTTP ${response.status} - ${errorMessage}`,
        );
    }

    return data as T;
}

async function consume(
    apiKey: string,
    userId: number,
    units: number,
    label: string,
): Promise<ConsumptionResult> {
    const result = await apiRequest<ConsumptionResult>(
        "/consumptions",
        {
            method: "POST",
            apiKey,
            body: {
                userId,
                units,
                requestId: `${label}-${randomUUID()}`,
            },
        },
    );

    console.log(
        `${label}: accepted=${result.accepted}, ` +
        `reason=${result.reason ?? "none"}, ` +
        `accountConsumed=${result.accountUsage.consumed}, ` +
        `userConsumed=${result.userUsage.consumed}`,
    );

    return result;
}

async function main(): Promise<void> {
    if (!adminApiKey) {
        throw new Error("ADMIN_API_KEY is required.");
    }

    await waitForService();

    const account = await apiRequest<CreatedAccount>("/accounts", {
        method: "POST",
        body: {
            name: `demo-${randomUUID()}`,
            planName: "Starter Account",
        },
    });

    const user = await apiRequest<CreatedUser>("/accounts/me/users", {
        method: "POST",
        apiKey: account.apiKey,
        body: {
            externalUserId: `demo-user-${randomUUID()}`,
            planName: "Basic User",
        },
    });

    const userId = Number(user.user.id);

    console.log("\n--- Usage Metering Demo ---");
    console.log("Created a demo account and a Basic User.");

    const accepted = await consume(
        account.apiKey,
        userId,
        5,
        "initial-accepted",
    );

    if (!accepted.accepted) {
        throw new Error("Expected the initial request to be accepted.");
    }

    const userRejected = await consume(
        account.apiKey,
        userId,
        21,
        "user-limit",
    );

    if (
        userRejected.accepted ||
        userRejected.reason !== "USER_REQUEST_LIMIT"
    ) {
        throw new Error("Expected rejection at the user request limit.");
    }

    const accountRejected = await consume(
        account.apiKey,
        userId,
        101,
        "account-limit",
    );

    if (
        accountRejected.accepted ||
        accountRejected.reason !== "ACCOUNT_REQUEST_LIMIT"
    ) {
        throw new Error("Expected rejection at the account request limit.");
    }

    console.log("\nSwitching the user's plan to Premium User...");

    await apiRequest("/admin/users/" + userId + "/plan", {
        method: "PATCH",
        adminKey: adminApiKey,
        body: { planName: "Premium User" },
    });

    console.log("Plan changed successfully. Client request code is unchanged.");

    const afterUpgrade = await consume(
        account.apiKey,
        userId,
        21,
        "after-plan-switch",
    );

    if (!afterUpgrade.accepted) {
        throw new Error("Expected the request to pass after the plan switch.");
    }

    if (
        afterUpgrade.accountUsage.consumed !== 26 ||
        afterUpgrade.userUsage.consumed !== 26
    ) {
        throw new Error("Unexpected usage counters after the plan switch.");
    }

    const history = await apiRequest<{
        total: number;
        records: Array<{
            accepted: boolean;
            reason: string | null;
        }>;
    }>("/usage/history?page=1&limit=10", {
        apiKey: account.apiKey,
    });

    console.log(`\nHistory records: ${history.total}`);
    console.log("Demo completed successfully.");
}

main().catch((error: unknown) => {
    console.error(
        "Demo failed:",
        error instanceof Error ? error.message : error,
    );
    process.exitCode = 1;
});
