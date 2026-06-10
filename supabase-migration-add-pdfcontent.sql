-- Migration: Adicionar campo pdfContent à tabela enterprises
-- Execute este SQL no Supabase SQL Editor

ALTER TABLE "enterprises" ADD COLUMN IF NOT EXISTS "pdfContent" TEXT;