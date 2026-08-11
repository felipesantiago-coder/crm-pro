-- CreateTable
CREATE TABLE "client_error_logs" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "source" TEXT,
    "lineNumber" INTEGER,
    "colNumber" INTEGER,
    "stackTrace" TEXT,
    "pageUrl" TEXT,
    "userAgent" TEXT,
    "slug" TEXT,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_error_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "client_error_logs_type_idx" ON "client_error_logs"("type");

-- CreateIndex
CREATE INDEX "client_error_logs_resolved_idx" ON "client_error_logs"("resolved");

-- CreateIndex
CREATE INDEX "client_error_logs_createdAt_idx" ON "client_error_logs"("createdAt");

-- CreateIndex
CREATE INDEX "client_error_logs_slug_idx" ON "client_error_logs"("slug");

-- CreateIndex
CREATE INDEX "client_error_logs_message_idx" ON "client_error_logs"("message");
