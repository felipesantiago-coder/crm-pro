-- Migration: Add Google Calendar fields to reminders table
-- Run this in Supabase SQL Editor

ALTER TABLE "reminders"
  ADD COLUMN IF NOT EXISTS "dueTime" TEXT,
  ADD COLUMN IF NOT EXISTS "googleCalendarEventId" TEXT;