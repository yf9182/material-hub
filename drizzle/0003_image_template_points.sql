INSERT INTO audit_events (id, product_id, actor_email, action, target_type, target_id, changes, created_at)
SELECT lower(hex(randomblob(12))), m.product_id, 'system@material-hub', 'material.price.backup', 'material', m.id,
  json_object('migration_id','image-template-price-v1','price',m.price,'updated_at',m.updated_at), unixepoch()
FROM materials m JOIN products p ON p.id=m.product_id
WHERE p.external_pid='8801' AND m.archived_at IS NULL
  AND json_valid(m.material_config_raw)
  AND CAST(json_extract(m.material_config_raw,'$.type') AS INTEGER) IN (1,2)
  AND NOT EXISTS (
    SELECT 1 FROM audit_events a
    WHERE a.action='material.price.backup' AND a.target_id=m.id
      AND json_extract(a.changes,'$.migration_id')='image-template-price-v1'
  );
--> statement-breakpoint
UPDATE materials
SET price=CASE WHEN unicode(substr(id,-1,1)) % 2=0 THEN 10 ELSE 20 END,
    is_free=0,
    updated_at=unixepoch()
WHERE product_id=(SELECT id FROM products WHERE external_pid='8801' AND archived_at IS NULL LIMIT 1)
  AND archived_at IS NULL
  AND json_valid(material_config_raw)
  AND CAST(json_extract(material_config_raw,'$.type') AS INTEGER) IN (1,2);
