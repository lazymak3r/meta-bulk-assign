import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Pooler URL for runtime queries
    url: process.env["DATABASE_URL"],
    // Direct connection for migrations (bypasses pgbouncer)
    directUrl: process.env["DIRECT_URL"],
  },
});
