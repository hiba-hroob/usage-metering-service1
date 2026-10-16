
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

    const accountRemaining = Math.max(
        0,
        result.accountUsage.allowance -
        result.accountUsage.consumed,
    );

    const userRemaining = Math.max(
        0,
        result.userUsage.allowance -
        result.userUsage.consumed,
    );

    console.log(
        `\n${label}`,
        `\n  Accepted: ${result.accepted}`,
        `\n  Reason: ${result.reason ?? "none"}`,
        `\n  Account quota: ${result.accountUsage.consumed}` +
        `/${result.accountUsage.allowance}` +
        ` consumed, ${accountRemaining} remaining`,
        `\n  User quota: ${result.userUsage.consumed}` +
        `/${result.userUsage.allowance}` +
        ` consumed, ${userRemaining} remaining`,
    );

    return result;
}

async function main(): Promise<void> {
    if (!adminApiKey) {
        throw new Error("ADMIN_API_KEY is required.");
    }

    await waitForService();

    // Create a fresh account for an isolated demo.
    const account = await apiRequest<CreatedAccount>("/accounts", {
        method: "POST",
        body: {
            name: `demo-${randomUUID()}`,
            planName: "Starter Account",
        },
    });

    const accountId = Number(account.account.id);

    // Create and assign a custom account plan with a shared
    // monthly allowance of 15 units.
    const accountPlanName = `Demo Shared Account ${randomUUID()}`;

    const accountPlan = await apiRequest<{
        plan: { id: number; name: string };
    }>("/plans", {
        method: "POST",
        apiKey: account.apiKey,
        body: {
            name: accountPlanName,
            scope: "account",
            monthlyAllowance: 15,
            maxUnitsPerRequest: 100,
        },
    });

    await apiRequest("/accounts/me/plan", {
        method: "PATCH",
        apiKey: account.apiKey,
        body: {
            planId: accountPlan.plan.id,
        },
    });

    // Create two different user plans owned by this account.
    const basicPlanName = `Demo Basic User ${randomUUID()}`;
    const premiumPlanName = `Demo Premium User ${randomUUID()}`;

    await apiRequest("/plans", {
        method: "POST",
        apiKey: account.apiKey,
        body: {
            name: basicPlanName,
            scope: "user",
            monthlyAllowance: 50,
            maxUnitsPerRequest: 100,
        },
    });

    await apiRequest("/plans", {
        method: "POST",
        apiKey: account.apiKey,
        body: {
            name: premiumPlanName,
            scope: "user",
            monthlyAllowance: 100,
            maxUnitsPerRequest: 100,
        },
    });

    const basicUser = await apiRequest<CreatedUser>(
        "/accounts/me/users",
        {
            method: "POST",
            apiKey: account.apiKey,
            body: {
                externalUserId: `demo-basic-${randomUUID()}`,
                planName: basicPlanName,
            },
        },
    );

    const premiumUser = await apiRequest<CreatedUser>(
        "/accounts/me/users",
        {
            method: "POST",
            apiKey: account.apiKey,
            body: {
                externalUserId: `demo-premium-${randomUUID()}`,
                planName: premiumPlanName,
            },
        },
    );

    const basicUserId = Number(basicUser.user.id);
    const premiumUserId = Number(premiumUser.user.id);

    console.log("\n--- Usage Metering Demo ---");
    console.log(`Account plan: ${accountPlanName}`);
    console.log("Shared account allowance: 15 units");
    console.log(`User 1 plan: ${basicPlanName} (50 units)`);
    console.log(`User 2 plan: ${premiumPlanName} (100 units)`);

    // User 1 consumes 8 units.
    const first = await consume(
        account.apiKey,
        basicUserId,
        8,
        "user-1-consumes-8",
    );

    if (
        !first.accepted ||
        first.accountUsage.consumed !== 8 ||
        first.userUsage.consumed !== 8
    ) {
        throw new Error("Expected user 1's request to be accepted.");
    }

    // User 2 consumes the remaining 7 shared account units.
    const second = await consume(
        account.apiKey,
        premiumUserId,
        7,
        "user-2-consumes-7",
    );

    if (
        !second.accepted ||
        second.accountUsage.consumed !== 15 ||
        second.userUsage.consumed !== 7
    ) {
        throw new Error("Expected user 2's request to be accepted.");
    }

    // The user still has their own allowance, but the shared
    // account allowance is exhausted.
    const sharedLimit = await consume(
        account.apiKey,
        premiumUserId,
        1,
        "shared-account-limit",
    );

    if (
        sharedLimit.accepted ||
        sharedLimit.reason !== "ACCOUNT_MONTHLY_LIMIT" ||
        sharedLimit.accountUsage.consumed !== 15 ||
        sharedLimit.userUsage.consumed !== 7
    ) {
        throw new Error(
            "Expected rejection because the shared account monthly quota is exhausted.",
        );
    }

    console.log(
        "\nShared monthly account quota enforced successfully.",
    );

    // Upgrade the account and user through the admin API.
    // The consumption request itself does not change.
    console.log("\nUpgrading the account to Pro Account...");

    await apiRequest(
        `/admin/accounts/${accountId}/plan`,
        {
            method: "PATCH",
            adminKey: adminApiKey,
            body: {
                planName: "Pro Account",
            },
        },
    );

    console.log("Upgrading user 1 to Premium User...");

    await apiRequest(
        `/admin/users/${basicUserId}/plan`,
        {
            method: "PATCH",
            adminKey: adminApiKey,
            body: {
                planName: "Premium User",
            },
        },
    );

    const afterUpgrade = await consume(
        account.apiKey,
        basicUserId,
        21,
        "after-plan-switch",
    );

    if (
        !afterUpgrade.accepted ||
        afterUpgrade.accountUsage.consumed !== 36 ||
        afterUpgrade.userUsage.consumed !== 29
    ) {
        throw new Error(
            "Unexpected usage after upgrading the plans.",
        );
    }

    // Display the final monthly usage summary.
    const usage = await apiRequest<{
        monthStart: string;
        account: {
            consumed: number;
            allowance: number;
            remaining: number;
        };
        users: Array<{
            id: number;
            externalUserId: string;
            planName: string;
            consumed: number;
            allowance: number;
            remaining: number;
        }>;
    }>("/usage", {
        apiKey: account.apiKey,
    });

    console.log(`\n--- Monthly Summary (${usage.monthStart}) ---`);

    console.log(
        `Account: ${usage.account.consumed}/` +
        `${usage.account.allowance} consumed; ` +
        `${usage.account.remaining} remaining`,
    );

    for (const user of usage.users) {
        console.log(
            `${user.externalUserId} | Plan: ${user.planName} | ` +
            `${user.consumed}/${user.allowance} consumed | ` +
            `${user.remaining} remaining`,
        );
    }

    const finalBasicUser = usage.users.find(
        (user) => user.id === basicUserId,
    );

    const finalPremiumUser = usage.users.find(
        (user) => user.id === premiumUserId,
    );

    if (
        usage.account.consumed !== 36 ||
        finalBasicUser?.consumed !== 29 ||
        finalPremiumUser?.consumed !== 7
    ) {
        throw new Error("Unexpected final monthly usage summary.");
    }

    const history = await apiRequest<{
        total: number;
    }>("/usage/history?page=1&limit=20", {
        apiKey: account.apiKey,
    });

    console.log(`\nHistory records: ${history.total}`);

    if (history.total !== 4) {
        throw new Error(
            `Expected 4 consumption records, received ${history.total}.`,
        );
    }

    console.log("\nDemo completed successfully.");
}

main().catch((error: unknown) => {
    console.error(
        "Demo failed:",
        error instanceof Error ? error.message : error,
    );
    process.exitCode = 1;
});
