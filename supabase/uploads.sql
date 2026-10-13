-- Run any time. Lets the admin upload photos up to 50 MB (the Supabase free-plan maximum) into the public "media" bucket.
-- The admin page also resizes big photos in the browser before uploading, so the website stays fast.
-- On a paid Supabase plan you can raise 52428800 (50 MB) and the global limit in Storage settings.
update storage.buckets set file_size_limit = 52428800, allowed_mime_types = array['image/jpeg','image/png','image/webp','image/gif','image/avif'] where id = 'media';
