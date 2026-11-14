
CREATE POLICY "Teachers read own pronunciations"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'pronunciations' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Teachers upload own pronunciations"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'pronunciations' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Teachers update own pronunciations"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'pronunciations' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Teachers delete own pronunciations"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'pronunciations' AND auth.uid()::text = (storage.foldername(name))[1]);
