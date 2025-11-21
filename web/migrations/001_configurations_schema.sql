-- Migration: Transform from vendor-based to configuration-based system
-- Date: 2025-11-20

-- Create configurations table
CREATE TABLE configurations (
    id SERIAL PRIMARY KEY,
    shop TEXT NOT NULL,
    name TEXT, -- Optional, can be NULL for auto-generated names
    type TEXT NOT NULL CHECK (type IN ('vendor', 'category', 'collection', 'product', 'combined')),
    metafield_configs TEXT NOT NULL, -- JSON string of metafield configurations
    priority INTEGER NOT NULL DEFAULT 0, -- Higher number = higher priority
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create configuration_rules table for AND/OR tree structure
CREATE TABLE configuration_rules (
    id SERIAL PRIMARY KEY,
    configuration_id INTEGER NOT NULL REFERENCES configurations(id) ON DELETE CASCADE,
    parent_id INTEGER REFERENCES configuration_rules(id) ON DELETE CASCADE, -- NULL for root nodes
    rule_type TEXT NOT NULL CHECK (rule_type IN ('vendor', 'collection', 'category', 'product')),
    rule_value TEXT NOT NULL, -- The actual value (vendor name, category name, etc.)
    rule_id TEXT, -- Shopify GID for collection/category/product if applicable
    operator TEXT NOT NULL CHECK (operator IN ('AND', 'OR')), -- How this rule relates to siblings
    level INTEGER NOT NULL DEFAULT 0, -- Tree depth (0 = root)
    position INTEGER NOT NULL DEFAULT 0, -- Order among siblings
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for better query performance
CREATE INDEX idx_configurations_shop ON configurations(shop);
CREATE INDEX idx_configurations_priority ON configurations(priority DESC);
CREATE INDEX idx_configuration_rules_config_id ON configuration_rules(configuration_id);
CREATE INDEX idx_configuration_rules_parent_id ON configuration_rules(parent_id);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger for configurations table
CREATE TRIGGER update_configurations_updated_at BEFORE UPDATE ON configurations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Add comments for documentation
COMMENT ON TABLE configurations IS 'Stores metafield configurations with targeting rules';
COMMENT ON COLUMN configurations.name IS 'Optional user-provided name, auto-generated if NULL';
COMMENT ON COLUMN configurations.type IS 'Auto-determined based on rules: vendor, category, collection, product, or combined';
COMMENT ON COLUMN configurations.priority IS 'Higher priority configs are applied first for auto-apply webhooks';
COMMENT ON COLUMN configurations.metafield_configs IS 'JSON array of metafield configuration objects';

COMMENT ON TABLE configuration_rules IS 'Stores AND/OR tree structure for product targeting';
COMMENT ON COLUMN configuration_rules.operator IS 'OR for horizontal siblings, AND for parent-child relationships';
COMMENT ON COLUMN configuration_rules.level IS 'Depth in tree: 0 = root, increases with nesting';
COMMENT ON COLUMN configuration_rules.position IS 'Order among siblings at same level';
