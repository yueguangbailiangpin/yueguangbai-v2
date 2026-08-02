PRAGMA foreign_keys = ON;
PRAGMA defer_foreign_keys = ON;

-- Wave 11 / Phase 3I: immutable review submission metadata.
-- Historical evidence versions intentionally retain NULL review_url values.
INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN EXISTS (
  SELECT 1 FROM app_schema_state
  WHERE singleton_id=1 AND schema_version=21
) THEN 1 ELSE 0 END;

ALTER TABLE review_evidence_versions
ADD COLUMN review_url TEXT
  CHECK (
    review_url IS NULL
    OR (
      typeof(review_url)='text'
      AND length(review_url) BETWEEN 9 AND 2048
    )
  );

CREATE INDEX idx_review_evidence_versions_current_url
ON review_evidence_versions (review_case_id, version_no, review_url);

-- The application performs NFKC normalization and WHATWG URL parsing. This
-- independent guard rejects non-HTTPS, credentials, fragments, empty hosts,
-- surrounding whitespace and missing URLs for non-rating reviews.
CREATE TRIGGER trg_review_evidence_version_url_guard
BEFORE INSERT ON review_evidence_versions
WHEN
  (NEW.review_type IN ('TEXT','IMAGE','VIDEO') AND NEW.review_url IS NULL)
  OR (
    NEW.review_url IS NOT NULL
    AND (
      typeof(NEW.review_url)<>'text'
      OR length(NEW.review_url) NOT BETWEEN 9 AND 2048
      OR substr(NEW.review_url,1,8)<>'https://'
      OR length(substr(
        NEW.review_url,
        9,
        instr(substr(NEW.review_url,9) || '/', '/')-1
      ))=0
      OR instr(substr(
        NEW.review_url,
        9,
        instr(substr(NEW.review_url,9) || '/', '/')-1
      ), '@')>0
      OR instr(NEW.review_url, '#')>0
      OR NEW.review_url<>trim(NEW.review_url)
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'review_evidence_version_url_invalid');
END;

-- The original immutable UPDATE/DELETE triggers also protect review_url.
INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN
  EXISTS (
    SELECT 1 FROM pragma_table_info('review_evidence_versions')
    WHERE name='review_url' AND type='TEXT'
  )
  AND EXISTS (
    SELECT 1 FROM sqlite_master
    WHERE type='trigger' AND name='trg_review_evidence_version_url_guard'
  )
  AND EXISTS (
    SELECT 1 FROM sqlite_master
    WHERE type='trigger' AND name='trg_review_evidence_versions_no_update'
  )
THEN 1 ELSE 0 END;

UPDATE app_schema_state
SET
  schema_version=22,
  installed_at=CAST(unixepoch('now') AS INTEGER) * 1000
WHERE singleton_id=1 AND schema_version=21;

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN changes()=1 THEN 1 ELSE 0 END;