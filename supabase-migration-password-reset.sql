-- Migration: Add password reset fields to users table
-- Run this in Supabase SQL Editor

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "passwordResetToken" TEXT,
  ADD COLUMN IF NOT EXISTS "passwordResetExpires" TIMESTAMP;
