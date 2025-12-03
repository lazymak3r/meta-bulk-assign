import { useState, useCallback } from "react";
import {
  LegacyCard,
  VerticalStack,
  Button,
  Select,
  TextField,
  Text,
  Banner,
} from "@shopify/polaris";
import { PlusIcon, DeleteIcon } from "@shopify/polaris-icons";
import MetaobjectFieldsEditor from "./MetaobjectFieldsEditor";

/**
 * Component for editing metafield configurations
 */
export function MetafieldConfigEditor({
  metafieldConfigs = [],
  onChange,
  metafieldDefinitions = [],
}) {
  const [uploadingFiles, setUploadingFiles] = useState({});
  const handleAddMetafield = useCallback(() => {
    const newConfig = {
      id: `metafield_${Date.now()}`,
      definitionId: "",
      namespace: "",
      key: "",
      value: "",
      type: "single_line_text_field",
      displayType: "", // Display type for storefront rendering
    };
    onChange([...metafieldConfigs, newConfig]);
  }, [metafieldConfigs, onChange]);

  const handleRemoveMetafield = useCallback(
    (index) => {
      const updated = metafieldConfigs.filter((_, i) => i !== index);
      onChange(updated);
    },
    [metafieldConfigs, onChange]
  );

  const handleUpdateMetafield = useCallback(
    (index, updates) => {
      const updated = metafieldConfigs.map((config, i) =>
        i === index ? { ...config, ...updates } : config
      );
      onChange(updated);
    },
    [metafieldConfigs, onChange]
  );

  const handleDefinitionChange = useCallback(
    (index, definitionId) => {
      const definition = metafieldDefinitions.find((d) => d.id === definitionId);
      if (definition) {
        const typeName = definition.type.name;
        const isMetaobjectReference = typeName === "metaobject_reference";
        const isListMetaobjectReference = typeName === "list.metaobject_reference";
        const isListFileReference = typeName === "list.file_reference";

        const updates = {
          definitionId: definition.id,
          namespace: definition.namespace,
          key: definition.key,
          type: typeName,
          value: isListMetaobjectReference ? [{}] : isListFileReference ? [] : isMetaobjectReference ? {} : "",
        };

        // For metaobject_reference types, also store the metaobject definition ID
        if (isMetaobjectReference || isListMetaobjectReference) {
          const metaobjectDefId = getMetaobjectDefinitionId(definition);
          if (metaobjectDefId) {
            updates.metaobjectDefinitionId = metaobjectDefId;
          }
        }

        handleUpdateMetafield(index, updates);
      }
    },
    [metafieldDefinitions, handleUpdateMetafield]
  );

  // Extract metaobject definition ID from validation
  const getMetaobjectDefinitionId = (fieldDef) => {
    const validation = fieldDef.validations?.find(
      (v) => v.name === "metaobject_definition_id"
    );
    return validation?.value;
  };

  // Handle adding an entry to list.metaobject_reference
  const handleAddListEntry = useCallback(
    (metafieldIndex) => {
      const config = metafieldConfigs[metafieldIndex];
      const currentValue = Array.isArray(config.value) ? config.value : [];
      handleUpdateMetafield(metafieldIndex, {
        value: [...currentValue, {}],
      });
    },
    [metafieldConfigs, handleUpdateMetafield]
  );

  // Handle removing an entry from list.metaobject_reference
  const handleRemoveListEntry = useCallback(
    (metafieldIndex, entryIndex) => {
      const config = metafieldConfigs[metafieldIndex];
      const currentValue = Array.isArray(config.value) ? config.value : [];
      const updated = currentValue.filter((_, i) => i !== entryIndex);
      handleUpdateMetafield(metafieldIndex, {
        value: updated.length > 0 ? updated : [{}],
      });
    },
    [metafieldConfigs, handleUpdateMetafield]
  );

  // Handle updating an entry in list.metaobject_reference
  const handleUpdateListEntry = useCallback(
    (metafieldIndex, entryIndex, entryValue) => {
      const config = metafieldConfigs[metafieldIndex];
      const currentValue = Array.isArray(config.value) ? config.value : [];
      const updated = currentValue.map((item, i) =>
        i === entryIndex ? entryValue : item
      );
      handleUpdateMetafield(metafieldIndex, { value: updated });
    },
    [metafieldConfigs, handleUpdateMetafield]
  );

  // Handle file upload for list.file_reference
  const handleFileUpload = useCallback(
    async (metafieldIndex, fileIndex, event) => {
      const file = event.target.files?.[0];
      if (!file) return;

      const uploadKey = `${metafieldIndex}-${fileIndex}`;
      setUploadingFiles((prev) => ({ ...prev, [uploadKey]: true }));

      try {
        const formData = new FormData();
        formData.append("file", file);

        const response = await fetch("/api/files/upload", {
          method: "POST",
          body: formData,
          headers: {
            // Don't set Content-Type - browser will set it with boundary for multipart
          },
        });

        const data = await response.json();

        if (!response.ok || !data.success) {
          const errorMsg = data.error || "Failed to upload file";
          throw new Error(errorMsg);
        }

        if (!data.file || !data.file.shopifyFileId) {
          throw new Error("Invalid response from upload endpoint");
        }

        const gid = data.file.shopifyFileId;

        // Update the file GID in the array
        const config = metafieldConfigs[metafieldIndex];
        const currentValue = Array.isArray(config.value) ? config.value : [];
        const updated = [...currentValue];
        updated[fileIndex] = gid;
        handleUpdateMetafield(metafieldIndex, { value: updated });
      } catch (error) {
        console.error("Error uploading file:", error);
        alert("Failed to upload file: " + error.message);
      } finally {
        setUploadingFiles((prev) => ({ ...prev, [uploadKey]: false }));
      }
    },
    [metafieldConfigs, handleUpdateMetafield]
  );

  // Handle adding a file to list.file_reference
  const handleAddFile = useCallback(
    (metafieldIndex) => {
      const config = metafieldConfigs[metafieldIndex];
      const currentValue = Array.isArray(config.value) ? config.value : [];
      handleUpdateMetafield(metafieldIndex, {
        value: [...currentValue, ""],
      });
    },
    [metafieldConfigs, handleUpdateMetafield]
  );

  // Handle removing a file from list.file_reference
  const handleRemoveFile = useCallback(
    (metafieldIndex, fileIndex) => {
      const config = metafieldConfigs[metafieldIndex];
      const currentValue = Array.isArray(config.value) ? config.value : [];
      const updated = currentValue.filter((_, i) => i !== fileIndex);
      handleUpdateMetafield(metafieldIndex, {
        value: updated.length > 0 ? updated : [],
      });
    },
    [metafieldConfigs, handleUpdateMetafield]
  );

  const definitionOptions = metafieldDefinitions.map((def) => ({
    label: `${def.name} (${def.namespace}.${def.key})`,
    value: def.id,
  }));

  if (metafieldDefinitions.length === 0) {
    return (
      <Banner tone="warning">
        <p>
          No metafield definitions found. Please create metafield definitions in
          your Shopify admin first.
        </p>
      </Banner>
    );
  }

  return (
    <VerticalStack gap="4">
      <VerticalStack gap="2">
        <Text as="h2" variant="headingMd">
          Metafield Configurations
        </Text>
        <Text as="p" tone="subdued">
          Add metafields that will be applied to matching products
        </Text>
      </VerticalStack>

      {metafieldConfigs.length === 0 ? (
        <LegacyCard sectioned>
          <div style={{ textAlign: "center", padding: "2rem" }}>
            <Text as="p" tone="subdued">
              No metafields configured yet. Click "Add Metafield" to get started.
            </Text>
          </div>
        </LegacyCard>
      ) : (
        <VerticalStack gap="3">
          {metafieldConfigs.map((config, index) => {
            const definition = metafieldDefinitions.find(
              (d) => d.id === config.definitionId
            );
            const isMetaobject = config.type === "metaobject_reference";
            const isListMetaobject = config.type === "list.metaobject_reference";
            const isListFile = config.type === "list.file_reference";
            const metaobjectDefinitionId = definition
              ? getMetaobjectDefinitionId(definition)
              : null;

            return (
              <LegacyCard key={config.id || index} sectioned>
                <VerticalStack gap="3">
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <Text as="h3" variant="headingSm">
                      Metafield {index + 1}
                    </Text>
                    <Button
                      icon={DeleteIcon}
                      destructive
                      onClick={() => handleRemoveMetafield(index)}
                    />
                  </div>

                  <Select
                    label="Metafield Definition"
                    options={definitionOptions}
                    value={config.definitionId}
                    onChange={(value) => handleDefinitionChange(index, value)}
                    placeholder="Select a metafield"
                  />

                  <Select
                    label="Storefront Display Type"
                    options={[
                      { label: "Select display type", value: "" },
                      { label: "Energy Label", value: "energy_label" },
                      { label: "Product Detail Icon", value: "product_detail_icon" },
                      { label: "Warranty Document", value: "warranty_document" },
                    ]}
                    value={config.displayType || ""}
                    onChange={(value) =>
                      handleUpdateMetafield(index, { displayType: value })
                    }
                    helpText="How this metafield should be displayed on product pages (optional)"
                  />

                  {config.definitionId && (
                    <>
                      {isListMetaobject && metaobjectDefinitionId ? (
                        <div>
                          <Text as="p" variant="bodyMd" fontWeight="semibold">
                            Entries (Add Multiple)
                          </Text>
                          <div style={{ marginTop: "1rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
                            {(Array.isArray(config.value) ? config.value : [{}]).map(
                              (entryValue, entryIndex) => (
                                <div key={`${config.id}-${index}-entry-${entryIndex}`} style={{ width: "100%" }}>
                                  <LegacyCard
                                    sectioned
                                    title={`Entry ${entryIndex + 1}`}
                                    actions={
                                      config.value.length > 1
                                        ? [
                                            {
                                              content: "Remove",
                                              destructive: true,
                                              onAction: () =>
                                                handleRemoveListEntry(index, entryIndex),
                                            },
                                          ]
                                        : []
                                    }
                                  >
                                    <MetaobjectFieldsEditor
                                      key={`${config.id}-${index}-entry-${entryIndex}-editor`}
                                      definitionId={metaobjectDefinitionId}
                                      initialValues={
                                        typeof entryValue === "object" ? entryValue : {}
                                      }
                                      onChange={(fieldValues) =>
                                        handleUpdateListEntry(
                                          index,
                                          entryIndex,
                                          fieldValues
                                        )
                                      }
                                      level={0}
                                      entryKey={`${index}-${entryIndex}`}
                                    />
                                  </LegacyCard>
                                </div>
                              )
                            )}
                            <Button
                              icon={PlusIcon}
                              onClick={() => handleAddListEntry(index)}
                            >
                              Add Entry
                            </Button>
                          </div>
                        </div>
                      ) : isListFile ? (
                        <div>
                          <Text as="p" variant="bodyMd" fontWeight="semibold">
                            Files (Add Multiple Images)
                          </Text>
                          <div style={{ marginTop: "1rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
                            {(Array.isArray(config.value) && config.value.length > 0 ? config.value : [""]).map(
                              (fileGid, fileIndex) => {
                                const uploadKey = `${index}-${fileIndex}`;
                                const uploadId = `file-upload-${config.id}-${fileIndex}`;
                                return (
                                  <div key={`${config.id}-${index}-file-${fileIndex}`} style={{ width: "100%" }}>
                                    <LegacyCard
                                      sectioned
                                      title={`File ${fileIndex + 1}`}
                                      actions={
                                        config.value.length > 1 || (config.value.length === 1 && fileGid)
                                          ? [
                                              {
                                                content: "Remove",
                                                destructive: true,
                                                onAction: () => handleRemoveFile(index, fileIndex),
                                              },
                                            ]
                                          : []
                                      }
                                    >
                                      <input
                                        id={uploadId}
                                        type="file"
                                        style={{ display: "none" }}
                                        onChange={(e) => handleFileUpload(index, fileIndex, e)}
                                        accept="image/*,application/pdf"
                                      />
                                      <Button
                                        loading={uploadingFiles[uploadKey]}
                                        onClick={() => document.getElementById(uploadId).click()}
                                      >
                                        {uploadingFiles[uploadKey]
                                          ? "Uploading..."
                                          : fileGid
                                          ? "Change File"
                                          : "Upload File"}
                                      </Button>
                                      {fileGid && (
                                        <p style={{ fontSize: "0.875rem", color: "#008060", marginTop: "8px" }}>
                                          File uploaded: {fileGid}
                                        </p>
                                      )}
                                    </LegacyCard>
                                  </div>
                                );
                              }
                            )}
                            <Button
                              icon={PlusIcon}
                              onClick={() => handleAddFile(index)}
                            >
                              Add File
                            </Button>
                          </div>
                        </div>
                      ) : isMetaobject && metaobjectDefinitionId ? (
                        <div>
                          <Text as="p" variant="bodyMd" fontWeight="semibold">
                            Metaobject Fields
                          </Text>
                          <div style={{ marginTop: "1rem" }}>
                            <MetaobjectFieldsEditor
                              definitionId={metaobjectDefinitionId}
                              initialValues={
                                typeof config.value === "object"
                                  ? config.value
                                  : {}
                              }
                              onChange={(fieldValues) =>
                                handleUpdateMetafield(index, {
                                  value: fieldValues,
                                })
                              }
                              level={0}
                            />
                          </div>
                        </div>
                      ) : (
                        <TextField
                          label="Value"
                          value={config.value}
                          onChange={(value) =>
                            handleUpdateMetafield(index, { value })
                          }
                          placeholder={`Enter value for ${config.type}`}
                          autoComplete="off"
                          multiline={config.type === "multi_line_text_field"}
                        />
                      )}
                    </>
                  )}
                </VerticalStack>
              </LegacyCard>
            );
          })}
        </VerticalStack>
      )}

      <Button icon={PlusIcon} onClick={handleAddMetafield}>
        Add Metafield
      </Button>
    </VerticalStack>
  );
}