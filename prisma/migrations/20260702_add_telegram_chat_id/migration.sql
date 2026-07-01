ALTER TABLE "users" ADD COLUMN "telegramChatId" TEXT;
CREATE UNIQUE INDEX "users_telegramChatId_key" ON "users"("telegramChatId") WHERE "telegramChatId" IS NOT NULL;
