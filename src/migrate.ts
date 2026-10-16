
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { pool } from "./db.js";

const runMigration = async (): Promise<void> => {
    const client = await pool.connect();

    try {
        const migrationsDirectory = join(
            process.cwd(),
            "src",
            "migrations",
        );

        const migrationFiles = (await readdir(migrationsDirectory))
            .filter((file) => file.endsWith(".sql"))
            .sort();

        await client.query(`
            CREATE TABLE IF NOT EXISTS schema_migrations (
                filename TEXT PRIMARY KEY,
                applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        `);

        for (const filename of migrationFiles) {
            const existing = await client.query(
                "SELECT filename FROM schema_migrations WHERE filename = $1",
                [filename],
            );

            if (existing.rowCount && existing.rowCount > 0) {
                console.log(`Skipping already applied migration: ${filename}`);
                continue;
            }

            const migrationPath = join(migrationsDirectory, filename);
            const sql = await readFile(migrationPath, "utf8");

            try {
                await client.query("BEGIN");
                await client.query(sql);
                await client.query(
                    "INSERT INTO schema_migrations (filename) VALUES ($1)",
                    [filename],
                );
                await client.query("COMMIT");

                console.log(`Applied migration: ${filename}`);
            } catch (error) {
                await client.query("ROLLBACK");
                throw error;
            }
        }

        console.log("Database migrations completed successfully.");
    } catch (error) {
        console.error("Database migration failed:", error);
        process.exitCode = 1;
    } finally {
        client.release();
        await pool.end();
    }
};

void runMigration();
