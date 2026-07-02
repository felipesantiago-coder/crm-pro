-- AlterTable: Add ntfyTopic and ntfyToken to users
ALTER TABLE "users" ADD COLUMN "ntfyTopic" TEXT;
ALTER TABLE "users" ADD COLUMN "ntfyToken" TEXT;

-- Create unique partial index on ntfyTopic (only non-null values must be unique)
CREATE UNIQUE INDEX "users_ntfyTopic_key" ON "users" ("ntfyTopic") WHERE "ntfyTopic" IS NOT NULL;