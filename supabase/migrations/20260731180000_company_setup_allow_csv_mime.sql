-- Permite CSV/texto e JSON no bucket company-setup (EPOC sync-day / exports).
-- Antes: só pkcs12, octet-stream, zip, xlsx — upload com text/csv falhava.

UPDATE storage.buckets
SET allowed_mime_types = ARRAY[
  'application/x-pkcs12',
  'application/pkcs12',
  'application/octet-stream',
  'application/zip',
  'application/x-zip-compressed',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
  'text/plain',
  'application/json'
]
WHERE id = 'company-setup';
