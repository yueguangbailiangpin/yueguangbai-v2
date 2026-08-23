-- 0074: scale index pack.  Read-only EXPLAIN QUERY PLAN audits on staging
-- (2026-08-24) confirmed four hot list queries degrade to full index scans
-- plus temp-B-tree sorts at scale:
--   * owner-wide work queue:  SCAN uq_staff_work_item_open_source + TEMP B-TREE
--   * dashboard bare business-date range: SCAN idx_formal_orders_canonical_market_date
--   * staff evidence list ORDER BY submitted_at: TEMP B-TREE (queue index sorts by updated_at)
--   * acquisition lead list: TEMP B-TREE (identity index buries created_at)
-- Zero behavior change: four covering-friendly b-tree indexes only.

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN (
  SELECT schema_version FROM app_schema_state WHERE singleton_id=1
)=73 THEN 1 ELSE 0 END;

CREATE INDEX idx_staff_work_items_status_created
ON staff_work_items (status, created_at, id);

CREATE INDEX idx_formal_orders_confirmed_business_date
ON formal_orders (confirmed_business_date, id);

CREATE INDEX idx_order_evidence_submission_submitted
ON order_evidence_submissions (status, submitted_at, id);

CREATE INDEX idx_acquisition_leads_type_created
ON acquisition_leads (lead_type, created_at, id);

UPDATE app_schema_state
SET schema_version=74,
  installed_at=CAST(unixepoch('now') AS INTEGER) * 1000
WHERE singleton_id=1 AND schema_version=73;

INSERT INTO transaction_assertions (assertion_value)
SELECT CASE WHEN changes()=1 THEN 1 ELSE 0 END;
