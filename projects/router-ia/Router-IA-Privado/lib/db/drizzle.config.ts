import { defineConfig } from "drizzle-kit";
import path from "path";

const databaseUrl =
  process.env.SUPABASE_DATABASE_URL?.trim() ||
  process.env.DATABASE_URL?.trim();
const commandNeedsDatabase = process.argv.some((argument) =>
  ["migrate", "push", "studio", "check"].includes(argument),
);

if (!databaseUrl && commandNeedsDatabase) {
  throw new Error(
    "Set SUPABASE_DATABASE_URL or DATABASE_URL before applying migrations.",
  );
}

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  out: path.join(__dirname, "./migrations"),
  dialect: "postgresql",
  dbCredentials: {
    // Drizzle Kit generate only reads the schema. A local placeholder keeps
    // that offline command usable; migrate/push/studio require a real URL.
    url: databaseUrl ?? "postgresql://localhost:5432/router_ia_migrations",
  },
});
