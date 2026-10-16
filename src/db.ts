
import { Pool } from "pg";

export const pool = new Pool({
    host: process.env.DB_HOST ?? "localhost",
    port: Number(process.env.DB_PORT ?? 5432),
    database: process.env.DB_NAME ?? "usage_metering",
    user: process.env.DB_USER ?? "usage_app",
    password: process.env.DB_PASSWORD ?? "dev_password_123",
});

pool.on("error", (error) => {
    console.error("Unexpected PostgreSQL connection error:", error);
});
