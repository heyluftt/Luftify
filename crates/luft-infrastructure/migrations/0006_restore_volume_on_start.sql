-- "Restore volume on start" is on by default from now on. Existing settings
-- get it once; whoever switches it off afterwards keeps it off.
UPDATE settings
SET value = json_set(value, '$.audioControl.restoreOnStart', json('true'))
WHERE key = 'app'
  AND json_valid(value)
  AND json_type(value, '$.audioControl') = 'object';
