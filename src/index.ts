import Fastify, {
    type FastifyReply,
    type FastifyRequest,
} from "fastify";
import cors from "@fastify/cors";
import {
    createHash,
    randomBytes,
    timingSafeEqual,
} from "node:crypto";
import { z } from "zod";
import { pool } from "./db.js";

export const app = Fastify({
    logger: true,
});

app.register(cors, {
    origin: [
        "http://localhost:5500",
        "http://127.0.0.1:5500",
        "http://localhost:8080",
        "http://127.0.0.1:8080",
        "http://localhost:5123",
    ],
});

const authorizeAdmin = (
    request: FastifyRequest,
    reply: FastifyReply,
): boolean => {
    const expectedKey = process.env.ADMIN_API_KEY;

    if (!expectedKey) {
        reply.code(503).send({
            error: "Admin API is not configured",
        });
        return false;
    }

    const providedKey = request.headers["x-admin-api-key"];

    if (typeof providedKey !== "string") {
        reply.code(401).send({
            error: "Missing admin API key",
        });
        return false;
    }

    const expected = Buffer.from(expectedKey);
    const provided = Buffer.from(providedKey);

    if (
        expected.length !== provided.length ||
        !timingSafeEqual(expected, provided)
    ) {
        reply.code(401).send({
            error: "Invalid admin API key",
        });
        return false;
    }

    return true;
};


const createAccountSchema = z.object({
    name: z.string().trim().min(1).max(150),
    planName: z.string().trim().min(1).default("Starter Account"),
});

app.post("/accounts", async (request, reply) => {
    const validation = createAccountSchema.safeParse(request.body);

    if (!validation.success) {
        return reply.code(400).send({
            error: "Invalid account data",
            details: validation.error.issues,
        });
    }

    const { name, planName } = validation.data;

    const apiKey = `um_${randomBytes(32).toString("hex")}`;

    const apiKeyHash = createHash("sha256")
        .update(apiKey)
        .digest("hex");

    try {
        const planResult = await pool.query(
            `SELECT id
     FROM plans
     WHERE name = $1
       AND scope = 'account'
       AND owner_account_id IS NULL`,
            [planName],
        );

        const plan = planResult.rows[0];

        if (!plan) {
            return reply.code(400).send({
                error: "Account plan not found",
            });
        }

        const accountResult = await pool.query(
            `INSERT INTO accounts (name, api_key_hash, plan_id)
             VALUES ($1, $2, $3)
             RETURNING id, name, plan_id, created_at`,
            [name, apiKeyHash, plan.id],
        );

        const account = accountResult.rows[0];

        return reply.code(201).send({
            account,
            apiKey,
        });
    } catch (error) {
        request.log.error(error);

        return reply.code(500).send({
            error: "Failed to create account",
        });
    }
});

const createUserSchema = z.object({
    externalUserId: z.string().trim().min(1).max(150),
    planName: z.string().trim().min(1).default("Basic User"),
});

app.post("/accounts/me/users", async (request, reply) => {
    const apiKey = request.headers["x-api-key"];

    if (typeof apiKey !== "string" || apiKey.length === 0) {
        return reply.code(401).send({
            error: "Missing API key",
        });
    }

    const validation = createUserSchema.safeParse(request.body);

    if (!validation.success) {
        return reply.code(400).send({
            error: "Invalid user data",
            details: validation.error.issues,
        });
    }

    const { externalUserId, planName } = validation.data;

    try {
        const accountResult = await pool.query(
            `SELECT id
             FROM accounts
             WHERE api_key_hash = $1`,
            [createHash("sha256").update(apiKey).digest("hex")],
        );

        const account = accountResult.rows[0];

        if (!account) {
            return reply.code(401).send({
                error: "Invalid API key",
            });
        }

        const planResult = await pool.query(
            `SELECT id
     FROM plans
     WHERE name = $1
       AND scope = 'user'
       AND (
           owner_account_id IS NULL
           OR owner_account_id = $2
       )
     ORDER BY
       CASE
           WHEN owner_account_id = $2 THEN 0
           ELSE 1
       END
     LIMIT 1`,
            [planName, account.id],
        );

        const plan = planResult.rows[0];

        if (!plan) {
            return reply.code(400).send({
                error: "User plan not found",
            });
        }

        const userResult = await pool.query(
            `INSERT INTO users (account_id, external_user_id, plan_id)
             VALUES ($1, $2, $3)
             RETURNING id, account_id, external_user_id, plan_id, created_at`,
            [account.id, externalUserId, plan.id],
        );

        return reply.code(201).send({
            user: userResult.rows[0],
        });
    } catch (error) {
        if (
            typeof error === "object" &&
            error !== null &&
            "code" in error &&
            error.code === "23505"
        ) {
            return reply.code(409).send({
                error: "User already exists in this account",
            });
        }


       request.log.error(error);

        return reply.code(500).send({
            error: "Failed to create user",
        });
    }
});


app.get("/accounts/me/users", async (request, reply) => {
    const apiKey = request.headers["x-api-key"];

    if (typeof apiKey !== "string" || apiKey.length === 0) {
        return reply.code(401).send({
            error: "Missing API key",
        });
    }

    try {
        const accountResult = await pool.query(
            `SELECT id
             FROM accounts
             WHERE api_key_hash = $1`,
            [createHash("sha256").update(apiKey).digest("hex")],
        );

        const account = accountResult.rows[0];

        if (!account) {
            return reply.code(401).send({
                error: "Invalid API key",
            });
        }

        const usersResult = await pool.query(
            `SELECT
                u.id,
                u.account_id,
                u.external_user_id,
                u.plan_id,
                p.name AS plan_name,
                u.created_at
             FROM users u
             LEFT JOIN plans p ON p.id = u.plan_id
             WHERE u.account_id = $1
             ORDER BY u.id DESC`,
            [account.id],
        );

        return reply.send({
            users: usersResult.rows,
        });
    } catch (error) {
        request.log.error(error);

        return reply.code(500).send({
            error: "Failed to retrieve users",
        });
    }
});



const consumeSchema = z.object({
    userId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    units: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    requestId: z.string().trim().min(1).max(150),
});

app.post("/consumptions", async (request, reply) => {
    const apiKey = request.headers["x-api-key"];

    if (typeof apiKey !== "string" || apiKey.length === 0) {
        return reply.code(401).send({ error: "Missing API key" });
    }

    const validation = consumeSchema.safeParse(request.body);

    if (!validation.success) {
        return reply.code(400).send({
            error: "Invalid consumption data",
            details: validation.error.issues,
        });
    }

    const { userId, units, requestId } = validation.data;
    const apiKeyHash = createHash("sha256").update(apiKey).digest("hex");
    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        // Lock the account so concurrent consumption requests are serialized.
        const accountResult = await client.query(
            `SELECT id, plan_id
             FROM accounts
             WHERE api_key_hash = $1
             FOR UPDATE`,
            [apiKeyHash],
        );

        const account = accountResult.rows[0];

        if (!account) {
            await client.query("ROLLBACK");
            return reply.code(401).send({ error: "Invalid API key" });
        }

        // The user must belong to the authenticated account.
        const userResult = await client.query(
            `SELECT id, plan_id
             FROM users
             WHERE id = $1 AND account_id = $2
             FOR UPDATE`,
            [userId, account.id],
        );

        const user = userResult.rows[0];

        if (!user) {
            await client.query("ROLLBACK");
            return reply.code(404).send({ error: "User not found in this account" });
        }

        // Idempotency: a repeated request ID must not consume units twice.
        const existingResult = await client.query(
            `SELECT user_id, units, accepted, reason
             FROM usage_records
             WHERE account_id = $1 AND request_id = $2`,
            [account.id, requestId],
        );

        const existing = existingResult.rows[0];

        if (existing) {
            if (
                Number(existing.user_id) !== userId ||
                Number(existing.units) !== units
            ) {
                await client.query("ROLLBACK");
                return reply.code(409).send({
                    error: "requestId already used with different data",
                });
            }

            await client.query("COMMIT");
            return reply.code(200).send({
                requestId,
                accepted: existing.accepted,
                reason: existing.reason,
                replayed: true,
            });
        }

        const plansResult = await client.query(
            `SELECT id, name, scope, monthly_allowance, max_units_per_request
             FROM plans
             WHERE id = $1 OR id = $2`,
            [account.plan_id, user.plan_id],
        );

        const accountPlan = plansResult.rows.find(
            (plan) => Number(plan.id) === Number(account.plan_id),
        );
        const userPlan = plansResult.rows.find(
            (plan) => Number(plan.id) === Number(user.plan_id),
        );

        if (!accountPlan || !userPlan) {
            throw new Error("Could not load account and user plans");
        }

        const now = new Date();
        const monthStart = new Date(
            Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
        ).toISOString().slice(0, 10);

        // Create both monthly counters if they do not exist yet.
        await client.query(
            `INSERT INTO monthly_usage (account_id, user_id, month_start)
             VALUES ($1, NULL, $2)
             ON CONFLICT (account_id, user_id, month_start) DO NOTHING`,
            [account.id, monthStart],
        );

        await client.query(
            `INSERT INTO monthly_usage (account_id, user_id, month_start)
             VALUES ($1, $2, $3)
             ON CONFLICT (account_id, user_id, month_start) DO NOTHING`,
            [account.id, userId, monthStart],
        );

        const usageResult = await client.query(
            `SELECT user_id, units_consumed
             FROM monthly_usage
             WHERE account_id = $1
               AND month_start = $2
               AND (user_id IS NULL OR user_id = $3)
             FOR UPDATE`,
            [account.id, monthStart, userId],
        );

        const accountUsage = usageResult.rows.find(
            (row) => row.user_id === null,
        );
        const userUsage = usageResult.rows.find(
            (row) => row.user_id !== null,
        );

        if (!accountUsage || !userUsage) {
            throw new Error("Could not load monthly usage counters");
        }

        const accountConsumed = Number(accountUsage.units_consumed);
        const userConsumed = Number(userUsage.units_consumed);

        let reason: string | null = null;

        if (units > Number(accountPlan.max_units_per_request)) {
            reason = "ACCOUNT_REQUEST_LIMIT";
        } else if (units > Number(userPlan.max_units_per_request)) {
            reason = "USER_REQUEST_LIMIT";
        } else if (
            accountConsumed + units >
            Number(accountPlan.monthly_allowance)
        ) {
            reason = "ACCOUNT_MONTHLY_LIMIT";
        } else if (
            userConsumed + units >
            Number(userPlan.monthly_allowance)
        ) {
            reason = "USER_MONTHLY_LIMIT";
        }

        const accepted = reason === null;

        if (accepted) {
            await client.query(
                `UPDATE monthly_usage
                 SET units_consumed = units_consumed + $1
                 WHERE account_id = $2
                   AND user_id IS NULL
                   AND month_start = $3`,
                [units, account.id, monthStart],
            );

            await client.query(
                `UPDATE monthly_usage
                 SET units_consumed = units_consumed + $1
                 WHERE account_id = $2
                   AND user_id = $3
                   AND month_start = $4`,
                [units, account.id, userId, monthStart],
            );
        }

        // Record accepted and rejected attempts. Rejections consume no quota.
        await client.query(
            `INSERT INTO usage_records
                (account_id, user_id, request_id, units, accepted, reason)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [account.id, userId, requestId, units, accepted, reason],
        );

        await client.query("COMMIT");

        return reply.code(200).send({
            requestId,
            accepted,
            reason,
            units,
            monthStart,
            accountUsage: {
                consumed: accountConsumed + (accepted ? units : 0),
                allowance: Number(accountPlan.monthly_allowance),
                maxUnitsPerRequest: Number(accountPlan.max_units_per_request),
            },
            userUsage: {
                consumed: userConsumed + (accepted ? units : 0),
                allowance: Number(userPlan.monthly_allowance),
                maxUnitsPerRequest: Number(userPlan.max_units_per_request),
            },
            replayed: false,
        });
    } catch (error) {
        await client.query("ROLLBACK");
        request.log.error(error);

        return reply.code(500).send({
            error: "Failed to process consumption",
        });
    } finally {
        client.release();
    }
});



app.get("/usage", async (request, reply) => {
    const apiKey = request.headers["x-api-key"];

    if (typeof apiKey !== "string" || apiKey.length === 0) {
        return reply.code(401).send({
            error: "Missing API key",
        });
    }

    try {
        const apiKeyHash = createHash("sha256")
            .update(apiKey)
            .digest("hex");

        const accountResult = await pool.query(
            `SELECT
                a.id,
                a.name,
                p.monthly_allowance,
                p.max_units_per_request
             FROM accounts a
             JOIN plans p ON p.id = a.plan_id
             WHERE a.api_key_hash = $1`,
            [apiKeyHash],
        );

        const account = accountResult.rows[0];

        if (!account) {
            return reply.code(401).send({
                error: "Invalid API key",
            });
        }

        const query = request.query as { month?: unknown };
        const requestedMonth = query.month;

        if (
            requestedMonth !== undefined &&
            (
                typeof requestedMonth !== "string" ||
                !/^\d{4}-(0[1-9]|1[0-2])$/.test(requestedMonth) ||
                requestedMonth.startsWith("0000")
            )
        ) {
            return reply.code(400).send({
                error: "Invalid month format. Use YYYY-MM, for example 2026-09",
            });
        }

        const monthStart = requestedMonth
            ? `${requestedMonth}-01`
            : new Date(
                Date.UTC(
                    new Date().getUTCFullYear(),
                    new Date().getUTCMonth(),
                    1,
                ),
            ).toISOString().slice(0, 10);

        const result = await pool.query(
            `SELECT
                u.id AS user_id,
                u.external_user_id,
                p.name AS plan_name,
                p.monthly_allowance,
                p.max_units_per_request,
                COALESCE(mu.units_consumed, 0) AS units_consumed
             FROM users u
             JOIN plans p ON p.id = u.plan_id
             LEFT JOIN monthly_usage mu
                ON mu.account_id = u.account_id
                AND mu.user_id = u.id
                AND mu.month_start = $2
             WHERE u.account_id = $1
             ORDER BY u.id`,
            [account.id, monthStart],
        );

        const accountUsageResult = await pool.query(
            `SELECT COALESCE(SUM(units_consumed), 0) AS units_consumed
             FROM monthly_usage
             WHERE account_id = $1
               AND user_id IS NULL
               AND month_start = $2`,
            [account.id, monthStart],
        );

        const accountConsumed = Number(
            accountUsageResult.rows[0].units_consumed,
        );
        const accountAllowance = Number(account.monthly_allowance);

        return reply.code(200).send({
            monthStart,
            account: {
                id: Number(account.id),
                name: account.name,
                consumed: accountConsumed,
                allowance: accountAllowance,
                remaining: Math.max(0, accountAllowance - accountConsumed),
                maxUnitsPerRequest: Number(account.max_units_per_request),
            },
            users: result.rows.map((user) => {
                const consumed = Number(user.units_consumed);
                const allowance = Number(user.monthly_allowance);

                return {
                    id: Number(user.user_id),
                    externalUserId: user.external_user_id,
                    planName: user.plan_name,
                    consumed,
                    allowance,
                    remaining: Math.max(0, allowance - consumed),
                    maxUnitsPerRequest: Number(user.max_units_per_request),
                };
            }),
        });
    } catch (error) {
        request.log.error(error);

        return reply.code(500).send({
            error: "Failed to retrieve usage",
        });
    }
});



const usageHistoryQuerySchema = z.object({
    page: z.coerce.number().int().min(1).max(1_000_000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
});

app.get("/usage/history", async (request, reply) => {
    const apiKey = request.headers["x-api-key"];

    if (typeof apiKey !== "string" || apiKey.length === 0) {
        return reply.code(401).send({
            error: "Missing API key",
        });
    }

    const validation = usageHistoryQuerySchema.safeParse(request.query);

    if (!validation.success) {
        return reply.code(400).send({
            error: "Invalid pagination parameters",
            details: validation.error.issues,
        });
    }

    const { page, limit } = validation.data;
    const offset = (page - 1) * limit;

    try {
        const apiKeyHash = createHash("sha256")
            .update(apiKey)
            .digest("hex");

        const accountResult = await pool.query(
            `SELECT id
             FROM accounts
             WHERE api_key_hash = $1`,
            [apiKeyHash],
        );

        const account = accountResult.rows[0];

        if (!account) {
            return reply.code(401).send({
                error: "Invalid API key",
            });
        }

        const historyResult = await pool.query(
            `SELECT
                id,
                user_id AS "userId",
                request_id AS "requestId",
                units,
                accepted,
                reason,
                created_at AS "createdAt"
             FROM usage_records
             WHERE account_id = $1
             ORDER BY created_at DESC, id DESC
             LIMIT $2 OFFSET $3`,
            [account.id, limit, offset],
        );

        const countResult = await pool.query(
            `SELECT COUNT(*) AS total
             FROM usage_records
             WHERE account_id = $1`,
            [account.id],
        );

        const total = Number(countResult.rows[0].total);

        return reply.code(200).send({
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
            records: historyResult.rows.map((record) => ({
                ...record,
                id: Number(record.id),
                userId: Number(record.userId),
                units: Number(record.units),
            })),
        });
    } catch (error) {
        request.log.error(error);

        return reply.code(500).send({
            error: "Failed to retrieve usage history",
        });
    }
});



const changePlanSchema = z.object({
    planName: z.string().trim().min(1).max(100),
});

const accountPlanParamsSchema = z.object({
    accountId: z.coerce
        .number()
        .int()
        .positive()
        .max(Number.MAX_SAFE_INTEGER),
});

const userPlanParamsSchema = z.object({
    userId: z.coerce
        .number()
        .int()
        .positive()
        .max(Number.MAX_SAFE_INTEGER),
});

app.patch("/admin/accounts/:accountId/plan", async (request, reply) => {
    if (!authorizeAdmin(request, reply)) {
        return;
    }

    const paramsValidation = accountPlanParamsSchema.safeParse(
        request.params,
    );
    const bodyValidation = changePlanSchema.safeParse(request.body);

    if (!paramsValidation.success || !bodyValidation.success) {
        return reply.code(400).send({
            error: "Invalid account plan change data",
        });
    }

    const { accountId } = paramsValidation.data;
    const { planName } = bodyValidation.data;

    try {
        const planResult = await pool.query(
            `SELECT id, name
             FROM plans
             WHERE name = $1
  AND scope = 'account'
  AND owner_account_id IS NULL`,
            [planName],
        );

        const plan = planResult.rows[0];

        if (!plan) {
            return reply.code(400).send({
                error: "Account plan not found",
            });
        }

        const updateResult = await pool.query(
            `UPDATE accounts
             SET plan_id = $1
             WHERE id = $2
             RETURNING id, name, plan_id`,
            [plan.id, accountId],
        );

        const account = updateResult.rows[0];

        if (!account) {
            return reply.code(404).send({
                error: "Account not found",
            });
        }

        return reply.code(200).send({
            account: {
                id: Number(account.id),
                name: account.name,
                planId: Number(account.plan_id),
                planName: plan.name,
            },
        });
    } catch (error) {
        request.log.error(error);

        return reply.code(500).send({
            error: "Failed to change account plan",
        });
    }
});

app.patch("/admin/users/:userId/plan", async (request, reply) => {
    if (!authorizeAdmin(request, reply)) {
        return;
    }

    const paramsValidation = userPlanParamsSchema.safeParse(
        request.params,
    );
    const bodyValidation = changePlanSchema.safeParse(request.body);

    if (!paramsValidation.success || !bodyValidation.success) {
        return reply.code(400).send({
            error: "Invalid user plan change data",
        });
    }

    const { userId } = paramsValidation.data;
    const { planName } = bodyValidation.data;

    try {
        const planResult = await pool.query(
            `SELECT id, name
             FROM plans
             WHERE name = $1
  AND scope = 'user'
  AND owner_account_id IS NULL`,
            [planName],
        );

        const plan = planResult.rows[0];

        if (!plan) {
            return reply.code(400).send({
                error: "User plan not found",
            });
        }

        const updateResult = await pool.query(
            `UPDATE users
             SET plan_id = $1
             WHERE id = $2
             RETURNING id, account_id, external_user_id, plan_id`,
            [plan.id, userId],
        );

        const user = updateResult.rows[0];

        if (!user) {
            return reply.code(404).send({
                error: "User not found",
            });
        }

        return reply.code(200).send({
            user: {
                id: Number(user.id),
                accountId: Number(user.account_id),
                externalUserId: user.external_user_id,
                planId: Number(user.plan_id),
                planName: plan.name,
            },
        });
    } catch (error) {
        request.log.error(error);

        return reply.code(500).send({
            error: "Failed to change user plan",
        });
    }
});


app.patch("/accounts/me/plan", async (request, reply) => {
    const apiKey = request.headers["x-api-key"];

    if (typeof apiKey !== "string" || apiKey.length === 0) {
        return reply.code(401).send({
            error: "Missing or invalid API key",
        });
    }

    const bodyValidation = z.object({
        planId: z.coerce.number()
            .int()
            .positive()
            .max(Number.MAX_SAFE_INTEGER),
    }).safeParse(request.body);

    if (!bodyValidation.success) {
        return reply.code(400).send({
            error: "A valid planId is required",
        });
    }

    try {
        const apiKeyHash = createHash("sha256")
            .update(apiKey)
            .digest("hex");

        const accountResult = await pool.query(
            `SELECT id
             FROM accounts
             WHERE api_key_hash = $1`,
            [apiKeyHash],
        );

        const account = accountResult.rows[0];

        if (!account) {
            return reply.code(401).send({
                error: "Invalid API key",
            });
        }

        const { planId } = bodyValidation.data;

        const planResult = await pool.query(
            `SELECT id, name
             FROM plans
             WHERE id = $1
               AND scope = 'account'
               AND (
                   owner_account_id IS NULL
                   OR owner_account_id = $2
               )`,
            [planId, account.id],
        );

        const plan = planResult.rows[0];

        if (!plan) {
            return reply.code(404).send({
                error: "Account plan not found",
            });
        }

        const updateResult = await pool.query(
            `UPDATE accounts
             SET plan_id = $1
             WHERE id = $2
             RETURNING id, name, plan_id`,
            [plan.id, account.id],
        );

        const updatedAccount = updateResult.rows[0];

        return reply.code(200).send({
            account: {
                id: Number(updatedAccount.id),
                name: updatedAccount.name,
                planId: Number(updatedAccount.plan_id),
                planName: plan.name,
            },
        });
    } catch (error) {
        request.log.error(error);

        return reply.code(500).send({
            error: "Failed to change account plan",
        });
    }
});


app.patch("/accounts/me/users/:userId/plan", async (request, reply) => {
    const apiKey = request.headers["x-api-key"];

    if (typeof apiKey !== "string" || apiKey.length === 0) {
        return reply.code(401).send({
            error: "Missing or invalid API key",
        });
    }

    const paramsValidation = z.object({
        userId: z.coerce.number()
            .int()
            .positive()
            .max(Number.MAX_SAFE_INTEGER),
    }).safeParse(request.params);

    const bodyValidation = z.object({
        planId: z.coerce.number()
            .int()
            .positive()
            .max(Number.MAX_SAFE_INTEGER),
    }).safeParse(request.body);

    if (!paramsValidation.success || !bodyValidation.success) {
        return reply.code(400).send({
            error: "Invalid user plan change data",
        });
    }

    try {
        const apiKeyHash = createHash("sha256")
            .update(apiKey)
            .digest("hex");

        const accountResult = await pool.query(
            `SELECT id
             FROM accounts
             WHERE api_key_hash = $1`,
            [apiKeyHash],
        );

        const account = accountResult.rows[0];

        if (!account) {
            return reply.code(401).send({
                error: "Invalid API key",
            });
        }

        const { userId } = paramsValidation.data;
        const { planId } = bodyValidation.data;

        const userResult = await pool.query(
            `SELECT id
             FROM users
             WHERE id = $1 AND account_id = $2`,
            [userId, account.id],
        );

        if (!userResult.rows[0]) {
            return reply.code(404).send({
                error: "User not found in this account",
            });
        }

        const planResult = await pool.query(
            `SELECT id, name
             FROM plans
             WHERE id = $1
               AND scope = 'user'
               AND (
                   owner_account_id IS NULL
                   OR owner_account_id = $2
               )`,
            [planId, account.id],
        );

        const plan = planResult.rows[0];

        if (!plan) {
            return reply.code(404).send({
                error: "User plan not found",
            });
        }

        const updateResult = await pool.query(
            `UPDATE users
             SET plan_id = $1
             WHERE id = $2
               AND account_id = $3
             RETURNING id, account_id, external_user_id, plan_id`,
            [plan.id, userId, account.id],
        );

        const user = updateResult.rows[0];

        if (!user) {
            return reply.code(404).send({
                error: "User not found in this account",
            });
        }

        return reply.code(200).send({
            user: {
                id: Number(user.id),
                accountId: Number(user.account_id),
                externalUserId: user.external_user_id,
                planId: Number(user.plan_id),
                planName: plan.name,
            },
        });
    } catch (error) {
        request.log.error(error);

        return reply.code(500).send({
            error: "Failed to change user plan",
        });
    }
});



app.get("/plans", async (request, reply) => {
    try {
        const apiKeyHeader = request.headers["x-api-key"];
        let ownerAccountId: number | null = null;

        // Without an API key, return predefined plans only.
        // With an API key, include only that account's custom plans.
        if (apiKeyHeader !== undefined) {
            if (
                typeof apiKeyHeader !== "string" ||
                apiKeyHeader.length === 0
            ) {
                return reply.code(401).send({
                    error: "Invalid API key",
                });
            }

            const apiKeyHash = createHash("sha256")
                .update(apiKeyHeader)
                .digest("hex");

            const accountResult = await pool.query(
                `SELECT id
                 FROM accounts
                 WHERE api_key_hash = $1`,
                [apiKeyHash],
            );

            const account = accountResult.rows[0];

            if (!account) {
                return reply.code(401).send({
                    error: "Invalid API key",
                });
            }

            ownerAccountId = Number(account.id);
        }

        const result = await pool.query(
            `SELECT
                id,
                name,
                scope,
                monthly_allowance AS "monthlyAllowance",
                max_units_per_request AS "maxUnitsPerRequest",
                (owner_account_id IS NULL) AS "predefined"
             FROM plans
             WHERE owner_account_id IS NULL
                OR owner_account_id = $1
             ORDER BY scope, monthly_allowance`,
            [ownerAccountId],
        );

        return reply.code(200).send({
            plans: result.rows.map((plan) => ({
                ...plan,
                id: Number(plan.id),
                monthlyAllowance: Number(plan.monthlyAllowance),
                maxUnitsPerRequest: Number(plan.maxUnitsPerRequest),
            })),
        });
    } catch (error) {
        request.log.error(error);

        return reply.code(500).send({
            error: "Failed to retrieve plans",
        });
    }
});


app.post("/plans", async (request, reply) => {
    try {
        const apiKey = request.headers["x-api-key"];

        if (typeof apiKey !== "string" || apiKey.length === 0) {
            return reply.code(401).send({
                error: "Missing or invalid API key",
            });
        }

        const apiKeyHash = createHash("sha256")
            .update(apiKey)
            .digest("hex");

        const accountResult = await pool.query(
            `SELECT id
             FROM accounts
             WHERE api_key_hash = $1`,
            [apiKeyHash],
        );

        const account = accountResult.rows[0];

        if (!account) {
            return reply.code(401).send({
                error: "Invalid API key",
            });
        }

        const body = (request.body ?? {}) as {
            name?: unknown;
            scope?: unknown;
            monthlyAllowance?: unknown;
            maxUnitsPerRequest?: unknown;
        };

        const name =
            typeof body.name === "string" ? body.name.trim() : "";

        const scope = body.scope;
        const monthlyAllowance = body.monthlyAllowance;
        const maxUnitsPerRequest = body.maxUnitsPerRequest;

        if (
            name.length === 0 ||
            name.length > 100 ||
            (scope !== "account" && scope !== "user") ||
            typeof monthlyAllowance !== "number" ||
            !Number.isSafeInteger(monthlyAllowance) ||
            monthlyAllowance <= 0 ||
            typeof maxUnitsPerRequest !== "number" ||
            !Number.isSafeInteger(maxUnitsPerRequest) ||
            maxUnitsPerRequest <= 0
        ) {
            return reply.code(400).send({
                error: "Invalid plan details",
                details:
                    "Provide a name, scope (account or user), and positive whole-number limits.",
            });
        }

        const result = await pool.query(
            `INSERT INTO plans (
                name,
                scope,
                monthly_allowance,
                max_units_per_request,
                owner_account_id
             )
             VALUES ($1, $2, $3, $4, $5)
             RETURNING
                id,
                name,
                scope,
                monthly_allowance AS "monthlyAllowance",
                max_units_per_request AS "maxUnitsPerRequest",
                owner_account_id AS "ownerAccountId"`,
            [
                name,
                scope,
                monthlyAllowance,
                maxUnitsPerRequest,
                account.id,
            ],
        );

        const plan = result.rows[0];

        return reply.code(201).send({
            plan: {
                ...plan,
                id: Number(plan.id),
                ownerAccountId: Number(plan.ownerAccountId),
                monthlyAllowance: Number(plan.monthlyAllowance),
                maxUnitsPerRequest: Number(plan.maxUnitsPerRequest),
                predefined: false,
            },
        });
    } catch (error) {
        const dbError = error as { code?: string };

        if (dbError.code === "23505") {
            return reply.code(409).send({
                error: "A plan with this name and scope already exists for this account",
            });
        }

        request.log.error(error);

        return reply.code(500).send({
            error: "Failed to create plan",
        });
    }
});



const customPlanIdSchema = z.object({
    planId: z.coerce
        .number()
        .int()
        .positive()
        .max(Number.MAX_SAFE_INTEGER),
});

const updateCustomPlanSchema = z.object({
    name: z.string().trim().min(1).max(100).optional(),
    monthlyAllowance: z.number()
        .int()
        .positive()
        .max(Number.MAX_SAFE_INTEGER)
        .optional(),
    maxUnitsPerRequest: z.number()
        .int()
        .positive()
        .max(Number.MAX_SAFE_INTEGER)
        .optional(),
}).refine(
    (body) =>
        body.name !== undefined ||
        body.monthlyAllowance !== undefined ||
        body.maxUnitsPerRequest !== undefined,
    {
        message: "At least one field must be provided",
    },
);

app.patch("/plans/:planId", async (request, reply) => {
    const apiKey = request.headers["x-api-key"];

    if (typeof apiKey !== "string" || apiKey.length === 0) {
        return reply.code(401).send({
            error: "Missing API key",
        });
    }

    const paramsValidation = customPlanIdSchema.safeParse(
        request.params,
    );
    const bodyValidation = updateCustomPlanSchema.safeParse(
        request.body,
    );

    if (!paramsValidation.success || !bodyValidation.success) {
        return reply.code(400).send({
            error: "Invalid custom plan update data",
        });
    }

    try {
        const apiKeyHash = createHash("sha256")
            .update(apiKey)
            .digest("hex");

        const accountResult = await pool.query(
            `SELECT id
             FROM accounts
             WHERE api_key_hash = $1`,
            [apiKeyHash],
        );

        const account = accountResult.rows[0];

        if (!account) {
            return reply.code(401).send({
                error: "Invalid API key",
            });
        }

        const { planId } = paramsValidation.data;
        const {
            name,
            monthlyAllowance,
            maxUnitsPerRequest,
        } = bodyValidation.data;

        const result = await pool.query(
            `UPDATE plans
             SET name = COALESCE($1, name),
                 monthly_allowance =
                     COALESCE($2, monthly_allowance),
                 max_units_per_request =
                     COALESCE($3, max_units_per_request)
             WHERE id = $4
               AND owner_account_id = $5
             RETURNING
                 id,
                 name,
                 scope,
                 monthly_allowance AS "monthlyAllowance",
                 max_units_per_request AS "maxUnitsPerRequest",
                 owner_account_id AS "ownerAccountId"`,
            [
                name ?? null,
                monthlyAllowance ?? null,
                maxUnitsPerRequest ?? null,
                planId,
                account.id,
            ],
        );

        const plan = result.rows[0];

        if (!plan) {
            return reply.code(404).send({
                error: "Custom plan not found",
            });
        }

        return reply.code(200).send({
            plan: {
                ...plan,
                id: Number(plan.id),
                ownerAccountId: Number(plan.ownerAccountId),
                monthlyAllowance: Number(plan.monthlyAllowance),
                maxUnitsPerRequest: Number(plan.maxUnitsPerRequest),
                predefined: false,
            },
        });
    } catch (error) {
        const dbError = error as { code?: string };

        if (dbError.code === "23505") {
            return reply.code(409).send({
                error: "A plan with this name and scope already exists for this account",
            });
        }

        request.log.error(error);

        return reply.code(500).send({
            error: "Failed to update custom plan",
        });
    }
});


app.get("/health", async () => {
    return {
        status: "ok",
        service: "usage-metering-service",
    };
});


app.get("/health/db", async (_request, reply) => {
    try {
        const result = await pool.query("SELECT NOW() AS current_time");

        return {
            status: "ok",
            database: "connected",
            currentTime: result.rows[0]?.current_time,
        };
    } catch (error) {
        app.log.error(error);

        return reply.code(503).send({
            status: "error",
            database: "unavailable",
        });
    }
});

const start = async (): Promise<void> => {
    try {
        await app.listen({
            port: 3000,
            host: "0.0.0.0",
        });
    } catch (error) {
        app.log.error(error);
        process.exit(1);
    }
};

if (require.main === module) {
    void start();
}
