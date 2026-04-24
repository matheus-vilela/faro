-- Compatibilidade de upload ZIP no Windows.
-- Alguns navegadores/SOs enviam ZIP como application/x-zip-compressed.

UPDATE storage.buckets
SET allowed_mime_types = ARRAY[
  'application/x-pkcs12',
  'application/pkcs12',
  'application/octet-stream',
  'application/zip',
  'application/x-zip-compressed',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel'
]
WHERE id = 'company-setup';

