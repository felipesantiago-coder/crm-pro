-- ============================================================
-- Migration: Ensure enterprise-images storage bucket exists
-- Run this in Supabase SQL Editor
-- ============================================================

-- Create storage bucket for enterprise images (if not exists)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'enterprise-images',
  'enterprise-images',
  true,
  5242880,  -- 5MB
  ARRAY['image/webp', 'image/jpeg', 'image/png', 'image/avif']
)
ON CONFLICT (id) DO NOTHING;

-- Set public read access on the bucket
CREATE POLICY "Public read access"
ON storage.objects FOR SELECT
USING (bucket_id = 'enterprise-images');

-- Set authenticated upload access
CREATE POLICY "Authenticated upload"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'enterprise-images' AND auth.role() = 'authenticated');

-- Set owner delete access (service role can delete)
CREATE POLICY "Service role full access"
ON storage.objects FOR ALL
USING (bucket_id = 'enterprise-images');