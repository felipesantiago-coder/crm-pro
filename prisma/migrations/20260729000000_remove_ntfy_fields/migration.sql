-- Drop ntfy notification fields from users table
-- (ntfy notification option removed, only Telegram remains)

DO $$ BEGIN
    -- Drop unique constraint on ntfyTopic if it exists
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_ntfyTopic_key') THEN
        ALTER TABLE "users" DROP CONSTRAINT "users_ntfyTopic_key";
    END IF;

    -- Drop ntfyTopic column if it exists
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'users' AND column_name = 'ntfyTopic'
    ) THEN
        ALTER TABLE "users" DROP COLUMN "ntfyTopic";
    END IF;

    -- Drop ntfyToken column if it exists
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'users' AND column_name = 'ntfyToken'
    ) THEN
        ALTER TABLE "users" DROP COLUMN "ntfyToken";
    END IF;
END $$;
