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
  const handleAddMetafield = useCallback(() => {
    const newConfig = {
      id: `metafield_${Date.now()}`,
      definitionId: "",
      namespace: "",
      key: "",
      value: "",
      type: "single_line_text_field",
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
        const updates = {
          definitionId: definition.id,
          namespace: definition.namespace,
          key: definition.key,
          type: definition.type.name,
          value: definition.type.name === "metaobject_reference" ? {} : "",
        };

        // For metaobject_reference, also store the metaobject definition ID
        if (definition.type.name === "metaobject_reference") {
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

                  {config.definitionId && (
                    <>
                      {/* <TextField
                        label="Namespace"
                        value={config.namespace}
                        disabled
                        autoComplete="off"
                      />

                      <TextField
                        label="Key"
                        value={config.key}
                        disabled
                        autoComplete="off"
                      /> */}

                      {isMetaobject && metaobjectDefinitionId ? (
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

                      {/*<Text as="p" variant="bodySm" tone="subdued">*/}
                      {/*  Type: {config.type}*/}
                      {/*</Text>*/}
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