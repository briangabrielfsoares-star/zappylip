-- LEGADO: não execute as antigas políticas públicas de upload/update/delete.
-- As mídias novas da RedDrop V8 usam Firebase Storage com login administrativo.
-- Os links antigos do Supabase continuam aparecendo normalmente porque o bucket pode permanecer público apenas para leitura.

drop policy if exists "Public upload media" on storage.objects;
drop policy if exists "Public update media" on storage.objects;
drop policy if exists "Public delete media" on storage.objects;
