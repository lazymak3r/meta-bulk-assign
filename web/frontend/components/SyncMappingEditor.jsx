import { useState, useCallback, useEffect } from "react";
import {
  Modal,
  FormLayout,
  Select,
  Text,
  Banner,
  Spinner,
  VerticalStack,
} from "@shopify/polaris";
import { useQuery } from "react-query";
import { useAuthenticatedFetch } from "../hooks";

const DISPLAY_TYPE_OPTIONS = [
  { label: "Select display type...", value: "" },
  { label: "Warranty Document (PDF download links)", value: "warranty_document" },
  { label: "Safety Document (embedded PDF viewer)", value: "safety_document" },
  { label: "Product Detail Icon (image thumbnails)", value: "product_detail_icon" },
];

const DISPLAY_TYPE_TARGETS = {
  warranty_document: { namespace: "custom", key: "warranty" },
  safety_document: { namespace: "custom", key: "safety_document" },
  product_detail_icon: { namespace: "custom", key: "icons_logos" },
};

export function SyncMappingEditor({ open, onClose, onSave, editingMapping }) {
  const authenticatedFetch = useAuthenticatedFetch();
  const [sourceMetafield, setSourceMetafield] = useState("");
  const [displayType, setDisplayType] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // Fetch source metafield definitions
  const { data: sourceMetafields, isLoading: loadingMetafields } = useQuery({
    queryKey: ["sync-source-metafields"],
    queryFn: async () => {
      const response = await authenticatedFetch("/api/sync/source-metafields");
      if (!response.ok) throw new Error("Failed to fetch source metafields");
      return response.json();
    },
    enabled: open,
    refetchOnWindowFocus: false,
  });

  // Reset form when opening/closing or when editingMapping changes
  useEffect(() => {
    if (open && editingMapping) {
      setSourceMetafield(`${editingMapping.source_namespace}.${editingMapping.source_key}`);
      setDisplayType(editingMapping.target_display_type);
    } else if (open) {
      setSourceMetafield("");
      setDisplayType("");
    }
    setError(null);
  }, [open, editingMapping]);

  const sourceMetafieldOptions = [
    { label: "Select source metafield...", value: "" },
    ...(sourceMetafields || []).map((def) => ({
      label: `${def.namespace}.${def.key} — ${def.type.name}${def.source === "unstructured" ? " (unstructured)" : ""}`,
      value: `${def.namespace}.${def.key}`,
    })),
  ];

  const handleSave = useCallback(async () => {
    setError(null);

    if (!sourceMetafield || !displayType) {
      setError("Please select both a source metafield and a display type.");
      return;
    }

    const dotIndex = sourceMetafield.indexOf(".");
    const source_namespace = sourceMetafield.substring(0, dotIndex);
    const source_key = sourceMetafield.substring(dotIndex + 1);
    setSaving(true);

    try {
      const url = editingMapping
        ? `/api/sync/mappings/${editingMapping.id}`
        : "/api/sync/mappings";
      const method = editingMapping ? "PUT" : "POST";

      const response = await authenticatedFetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source_namespace,
          source_key,
          target_display_type: displayType,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to save mapping");
      }

      onSave();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }, [sourceMetafield, displayType, editingMapping, authenticatedFetch, onSave]);

  const target = DISPLAY_TYPE_TARGETS[displayType];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editingMapping ? "Edit Sync Mapping" : "Add Sync Mapping"}
      primaryAction={{
        content: saving ? "Saving..." : "Save",
        onAction: handleSave,
        disabled: saving || !sourceMetafield || !displayType,
        loading: saving,
      }}
      secondaryActions={[{ content: "Cancel", onAction: onClose }]}
    >
      <Modal.Section>
        <VerticalStack gap="4">
          {error && (
            <Banner tone="critical" onDismiss={() => setError(null)}>
              {error}
            </Banner>
          )}

          {loadingMetafields ? (
            <Spinner size="small" />
          ) : (
            <FormLayout>
              <Select
                label="Source Metafield"
                helpText="The middleware-imported metafield containing file URLs"
                options={sourceMetafieldOptions}
                value={sourceMetafield}
                onChange={setSourceMetafield}
              />

              <Select
                label="Display Type"
                helpText="How this data should appear on the storefront"
                options={DISPLAY_TYPE_OPTIONS}
                value={displayType}
                onChange={setDisplayType}
              />

              {target && (
                <Banner tone="info">
                  <Text as="p" variant="bodyMd">
                    Files will be uploaded to Shopify and stored in{" "}
                    <strong>{target.namespace}.{target.key}</strong> as{" "}
                    <strong>list.file_reference</strong>.
                  </Text>
                </Banner>
              )}
            </FormLayout>
          )}
        </VerticalStack>
      </Modal.Section>
    </Modal>
  );
}
