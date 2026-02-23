-- CreateTable
CREATE TABLE "configurations" (
    "id" SERIAL NOT NULL,
    "shop" TEXT NOT NULL,
    "name" TEXT,
    "type" TEXT NOT NULL,
    "metafield_configs" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "show_on_storefront" BOOLEAN DEFAULT false,
    "storefront_position" TEXT DEFAULT 'after_price',
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "configurations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "configuration_rules" (
    "id" SERIAL NOT NULL,
    "configuration_id" INTEGER NOT NULL,
    "parent_id" INTEGER,
    "rule_type" TEXT NOT NULL,
    "rule_value" TEXT NOT NULL,
    "rule_id" TEXT,
    "operator" TEXT NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 0,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "configuration_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_mappings" (
    "id" SERIAL NOT NULL,
    "shop" TEXT NOT NULL,
    "source_namespace" TEXT NOT NULL,
    "source_key" TEXT NOT NULL,
    "target_display_type" TEXT NOT NULL,
    "target_namespace" TEXT NOT NULL,
    "target_key" TEXT NOT NULL,
    "target_metafield_type" TEXT NOT NULL DEFAULT 'list.file_reference',
    "enabled" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_jobs" (
    "id" SERIAL NOT NULL,
    "shop" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "total_products" INTEGER DEFAULT 0,
    "processed_products" INTEGER DEFAULT 0,
    "successful_products" INTEGER DEFAULT 0,
    "failed_products" INTEGER DEFAULT 0,
    "skipped_products" INTEGER DEFAULT 0,
    "total_files_uploaded" INTEGER DEFAULT 0,
    "total_files_skipped" INTEGER DEFAULT 0,
    "errors" TEXT DEFAULT '[]',
    "file_product_map" TEXT DEFAULT '{}',
    "mapping_snapshot" TEXT NOT NULL,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_file_cache" (
    "id" SERIAL NOT NULL,
    "shop" TEXT NOT NULL,
    "external_url" TEXT NOT NULL,
    "shopify_file_gid" TEXT NOT NULL,
    "filename" TEXT,
    "mime_type" TEXT,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_file_cache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_configurations_shop" ON "configurations"("shop");

-- CreateIndex
CREATE INDEX "idx_configurations_priority" ON "configurations"("priority" DESC);

-- CreateIndex
CREATE INDEX "idx_configuration_rules_config_id" ON "configuration_rules"("configuration_id");

-- CreateIndex
CREATE INDEX "idx_configuration_rules_parent_id" ON "configuration_rules"("parent_id");

-- CreateIndex
CREATE INDEX "idx_sync_mappings_shop" ON "sync_mappings"("shop");

-- CreateIndex
CREATE INDEX "idx_sync_jobs_shop" ON "sync_jobs"("shop");

-- CreateIndex
CREATE INDEX "idx_sync_file_cache_shop_url" ON "sync_file_cache"("shop", "external_url");

-- CreateIndex
CREATE UNIQUE INDEX "sync_file_cache_shop_external_url_key" ON "sync_file_cache"("shop", "external_url");

-- AddForeignKey
ALTER TABLE "configuration_rules" ADD CONSTRAINT "configuration_rules_configuration_id_fkey" FOREIGN KEY ("configuration_id") REFERENCES "configurations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "configuration_rules" ADD CONSTRAINT "configuration_rules_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "configuration_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;
