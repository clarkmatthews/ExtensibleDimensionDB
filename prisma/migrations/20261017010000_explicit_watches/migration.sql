-- Watching a record is now only ever someone's own choice. Clear the watches that were added
-- automatically (from recent edits and from saving records) so everyone starts from their own clicks.
DELETE FROM "RecordWatch";
