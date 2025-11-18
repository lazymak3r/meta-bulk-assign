import { useState, useEffect } from "react";
import {
  TextField,
  Button,
  Spinner,
  LegacyCard,
  FormLayout,
  VerticalStack,
  Banner,
} from "@shopify/polaris";
import { useAppBridge } from "@shopify/app-bridge-react";

/**
 * Recursive component for editing metaobject fields
 * Handles nested metaobject_reference fields
 */
export default function MetaobjectFieldsEditor({
  definitionId,
  initialValues = {},
  onChange,
  level = 0,
}) {
  const shopify = useAppBridge();
  const [definition, setDefinition] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [fieldValues, setFieldValues] = useState(initialValues);
  const [nestedDefinitions, setNestedDefinitions] = useState({});
  const [uploadingFiles, setUploadingFiles] = useState({});

  // Fetch metaobject definition
  useEffect(() => {
    async function fetchDefinition() {
      try {
        setLoading(true);
        setError(null);

        const response = await fetch(
          `/api/metaobject-definitions/${encodeURIComponent(definitionId)}`
        );

        if (!response.ok) {
          throw new Error(`Failed to fetch definition: ${response.status}`);
        }

        const data = await response.json();

        if (!data.success) {
          throw new Error(data.error || "Failed to fetch definition");
        }

        setDefinition(data.definition);

        // Initialize field values with defaults if not already set
        const initialFieldValues = { ...initialValues };
        data.definition.fieldDefinitions.forEach((field) => {
          if (initialFieldValues[field.key] === undefined) {
            initialFieldValues[field.key] = "";
          }
        });
        setFieldValues(initialFieldValues);
      } catch (err) {
        console.error("Error fetching metaobject definition:", err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }

    fetchDefinition();
  }, [definitionId]);

  // Notify parent when values change
  useEffect(() => {
    if (onChange && definition) {
      onChange(fieldValues);
    }
  }, [fieldValues, definition]);

  const handleFieldChange = (fieldKey, value) => {
    setFieldValues((prev) => ({
      ...prev,
      [fieldKey]: value,
    }));
  };

  const handleFileUpload = async (fieldKey, event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploadingFiles((prev) => ({ ...prev, [fieldKey]: true }));

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/files/upload", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Upload failed: ${response.status}`);
      }

      const data = await response.json();

      if (data.success) {
        handleFieldChange(fieldKey, data.file.shopifyFileId);
        shopify.toast.show("File uploaded successfully");
      } else {
        throw new Error(data.error || "Upload failed");
      }
    } catch (error) {
      console.error("File upload error:", error);
      shopify.toast.show(`File upload failed: ${error.message}`, {
        isError: true,
      });
    } finally {
      setUploadingFiles((prev) => ({ ...prev, [fieldKey]: false }));
    }
  };

  // Extract metaobject definition ID from validation
  const getMetaobjectDefinitionId = (fieldDef) => {
    const validation = fieldDef.validations?.find(
      (v) => v.name === "metaobject_definition_id"
    );
    return validation?.value;
  };

  if (loading) {
    return (
      <div style={{ padding: "1rem", textAlign: "center" }}>
        <Spinner size="small" />
      </div>
    );
  }

  if (error) {
    return (
      <Banner status="critical">
        <p>Error loading metaobject definition: {error}</p>
      </Banner>
    );
  }

  if (!definition) {
    return (
      <Banner status="warning">
        <p>No metaobject definition found</p>
      </Banner>
    );
  }

  const renderField = (fieldDef) => {
    const fieldKey = fieldDef.key;
    const fieldType = fieldDef.type.name;
    const fieldValue = fieldValues[fieldKey] || "";

    switch (fieldType) {
      case "metaobject_reference": {
        // Nested metaobject - render recursively
        const nestedDefinitionId = getMetaobjectDefinitionId(fieldDef);

        if (!nestedDefinitionId) {
          return (
            <Banner key={fieldKey} status="warning">
              <p>
                Cannot determine metaobject type for field: {fieldDef.name}
              </p>
            </Banner>
          );
        }

        return (
          <div key={fieldKey}>
            <LegacyCard
              title={`${fieldDef.name}${fieldDef.required ? " *" : ""}`}
              sectioned
            >
              <VerticalStack gap={{ xs: "2" }}>
                {fieldDef.description && <p>{fieldDef.description}</p>}
                <MetaobjectFieldsEditor
                  definitionId={nestedDefinitionId}
                  initialValues={
                    typeof fieldValue === "object" ? fieldValue : {}
                  }
                  onChange={(nestedValues) =>
                    handleFieldChange(fieldKey, nestedValues)
                  }
                  level={level + 1}
                />
              </VerticalStack>
            </LegacyCard>
          </div>
        );
      }

      case "file_reference": {
        return (
          <div key={fieldKey}>
            <label style={{ fontWeight: 500, marginBottom: "8px", display: "block" }}>
              {fieldDef.name}
              {fieldDef.required && <span style={{ color: "red" }}> *</span>}
            </label>
            {fieldDef.description && (
              <p style={{ fontSize: "0.875rem", marginBottom: "8px" }}>
                {fieldDef.description}
              </p>
            )}
            <input
              id={`file-upload-${fieldKey}`}
              type="file"
              style={{ display: "none" }}
              onChange={(e) => handleFileUpload(fieldKey, e)}
              accept="*/*"
            />
            <Button
              loading={uploadingFiles[fieldKey]}
              onClick={() =>
                document.getElementById(`file-upload-${fieldKey}`).click()
              }
            >
              {uploadingFiles[fieldKey]
                ? "Uploading..."
                : fieldValue
                ? "Change File"
                : "Upload File"}
            </Button>
            {fieldValue && (
              <p style={{ fontSize: "0.875rem", color: "#008060", marginTop: "8px" }}>
                File uploaded: {fieldValue}
              </p>
            )}
          </div>
        );
      }

      case "single_line_text_field":
      case "multi_line_text_field":
      default: {
        return (
          <TextField
            key={fieldKey}
            label={fieldDef.name}
            value={fieldValue}
            onChange={(value) => handleFieldChange(fieldKey, value)}
            placeholder={fieldDef.description || `Enter ${fieldDef.name}`}
            multiline={fieldType === "multi_line_text_field"}
            requiredIndicator={fieldDef.required}
          />
        );
      }
    }
  };

  return (
    <div
      style={{
        paddingLeft: level > 0 ? "1rem" : "0",
        borderLeft: level > 0 ? "2px solid #e1e3e5" : "none",
      }}
    >
      <FormLayout>
        {definition.fieldDefinitions.map((fieldDef) => renderField(fieldDef))}
      </FormLayout>
    </div>
  );
}
