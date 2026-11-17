-- The Bernstein theme was removed; whoever used it continues with Luft Dark.
UPDATE settings
SET value = json_set(value, '$.theme', 'dark')
WHERE key = 'app'
  AND json_valid(value)
  AND json_extract(value, '$.theme') IN ('bernstein', 'luft.bernstein');
