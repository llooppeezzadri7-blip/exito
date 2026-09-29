import pg from "pg";
import { env } from "../config/env.js";
import { runMigrations } from "./migrate.js";

if (!env.DATABASE_URL) {
  console.error("DATABASE_URL is required to run migrations");
  process.exit(1);
}
const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 2 });
runMigrations(pool)
  .then((ran) => {
    console.log(ran.length ? `applied: ${ran.join(", ")}` : "schema up to date");
    return pool.end();
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
