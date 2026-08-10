UPDATE materials
SET price = (
      SELECT CAST(json_extract(a.changes, '$.price') AS INTEGER)
      FROM audit_events a
      WHERE a.action = 'material.price.backup'
        AND a.target_type = 'material'
        AND a.target_id = materials.id
        AND json_extract(a.changes, '$.migration_id') = 'image-template-price-v1'
      ORDER BY a.created_at DESC
      LIMIT 1
    ),
    updated_at = (
      SELECT CAST(json_extract(a.changes, '$.updated_at') AS INTEGER)
      FROM audit_events a
      WHERE a.action = 'material.price.backup'
        AND a.target_type = 'material'
        AND a.target_id = materials.id
        AND json_extract(a.changes, '$.migration_id') = 'image-template-price-v1'
      ORDER BY a.created_at DESC
      LIMIT 1
    )
WHERE EXISTS (
  SELECT 1
  FROM audit_events a
  WHERE a.action = 'material.price.backup'
    AND a.target_type = 'material'
    AND a.target_id = materials.id
    AND json_extract(a.changes, '$.migration_id') = 'image-template-price-v1'
);
