import { useState, useCallback, useEffect } from "react";
import {
    Icon,
    Page,
    Modal,
    Badge,
    Layout,
    Select,
    Button,
    Banner,
    Spinner,
    Checkbox,
    TextField,
    LegacyCard,
    FormLayout,
    Collapsible,
    VerticalStack, LegacyStack,
} from "@shopify/polaris";
import { useAppBridge } from "@shopify/app-bridge-react";
import { useParams, useNavigate } from "react-router-dom";
import { ChevronDownIcon, ChevronUpIcon } from "@shopify/polaris-icons";
import { useQuery, useMutation, useQueryClient } from "react-query";

export default function VendorConfig() {
  const { name } = useParams();
  const navigate = useNavigate();
  const shopify = useAppBridge();
  const queryClient = useQueryClient();
  const vendorName = decodeURIComponent(name);

  const [metafieldConfigs, setMetafieldConfigs] = useState([]);
  const [showApplyModal, setShowApplyModal] = useState(false);
  const [applyResults, setApplyResults] = useState(null);
  const [uploadingFiles, setUploadingFiles] = useState({});
  const [selectedCategories, setSelectedCategories] = useState(new Set());
  const [expandedCategories, setExpandedCategories] = useState(new Set());
  const [loadingFileMetadata, setLoadingFileMetadata] = useState(false);

  const { data: vendorData, isLoading: vendorLoading } = useQuery({
    queryKey: ["vendor", vendorName],
    queryFn: async () => {
      const response = await fetch(`/api/vendors/${encodeURIComponent(vendorName)}`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const text = await response.text();
      return text ? JSON.parse(text) : {};
    },
    onSuccess: (data) => {
      if (data.success && data.vendor.metafield_configs) {
        setMetafieldConfigs(data.vendor.metafield_configs);
      }
    },
    refetchOnWindowFocus: false,
  });
  const { data: definitionsData } = useQuery({
    queryKey: ["metafieldDefinitions"],
    queryFn: async () => {
      const response = await fetch("/api/metafield-definitions");
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const text = await response.text();
      return text ? JSON.parse(text) : {};
    },
    refetchOnWindowFocus: false,
  });
  const { data: productsData, isLoading: productsLoading } = useQuery({
    queryKey: ["vendorProducts", vendorName],
    queryFn: async () => {
      const response = await fetch(`/api/vendors/${encodeURIComponent(vendorName)}/products`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const text = await response.text();
      return text ? JSON.parse(text) : {};
    },
    refetchOnWindowFocus: false,
  });
  const saveMutation = useMutation({
    mutationFn: async (config) => {
      const response = await fetch(`/api/vendors/${encodeURIComponent(vendorName)}/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ metafieldConfigs: config }),
      });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const text = await response.text();
      return text ? JSON.parse(text) : {};
    },
    onSuccess: () => {
      shopify.toast.show("Configuration saved successfully");
      queryClient.invalidateQueries(["vendor", vendorName]);
      queryClient.invalidateQueries(["vendors"]);
    },
    onError: (error) => {
      shopify.toast.show("Error saving configuration", { isError: true });
    },
  });
  const applyMutation = useMutation({
    mutationFn: async (selectedCategories) => {
      const response = await fetch(`/api/vendors/${encodeURIComponent(vendorName)}/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selectedCategories: Array.from(selectedCategories) }),
      });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const text = await response.text();
      return text ? JSON.parse(text) : {};
    },
    onSuccess: (data) => {
      setApplyResults(data.results);
      shopify.toast.show("Metafields applied to products");
      queryClient.invalidateQueries(["vendorProducts", vendorName]);
    },
    onError: (error) => {
      shopify.toast.show("Error applying configuration", { isError: true });
    },
  });

  const definitions = definitionsData?.definitions || [];
  const vendor = vendorData?.vendor;
  const products = productsData?.products || [];
  const categories = productsData?.categories || [];

  useEffect(() => {
    const fetchFileMetadata = async () => {
      const configsNeedingMetadata = metafieldConfigs
        .map((config, index) => ({ config, index }))
        .filter(({ config }) =>
          config.type === 'file_reference' &&
          config.value &&
          config.value.startsWith('gid://') &&
          !config.fileUrl
        );

      if (configsNeedingMetadata.length === 0) return;

      setLoadingFileMetadata(true);

      try {
        for (const { config, index } of configsNeedingMetadata) {
          try {
            const response = await fetch(`/api/files/metadata?gid=${encodeURIComponent(config.value)}`);
            if (response.ok) {
              const data = await response.json();
              if (data.success && data.file) {
                // Update config with file metadata
                handleMetafieldChange(index, 'fileName', data.file.filename);
                handleMetafieldChange(index, 'fileUrl', data.file.file_url);
              }
            }
          } catch (error) {
            console.error(`Failed to fetch metadata for ${config.value}:`, error);
          }
        }
      } finally {
        setLoadingFileMetadata(false);
      }
    };

    fetchFileMetadata();
  }, [metafieldConfigs.length]);

  const handleAddMetafield = () => {
    setMetafieldConfigs([
      ...metafieldConfigs,
      { namespace: "", key: "", value: "", type: "single_line_text_field" },
    ]);
  };

  const handleRemoveMetafield = (index) => {
    const newConfigs = metafieldConfigs.filter((_, i) => i !== index);
    setMetafieldConfigs(newConfigs);
  };

  const handleMetafieldChange = (index, field, value) => {
    const newConfigs = [...metafieldConfigs];
    newConfigs[index] = { ...newConfigs[index], [field]: value };
    setMetafieldConfigs(newConfigs);
  };

  const handleSelectDefinition = (index, definitionId) => {
    const definition = definitions.find((d) => d.id === definitionId);
    if (definition) {
      const newConfigs = [...metafieldConfigs];
      newConfigs[index] = {
        ...newConfigs[index],
        definitionId: definitionId,
        namespace: definition.namespace,
        key: definition.key,
        type: definition.type.name,
      };
      setMetafieldConfigs(newConfigs);
    }
  };

  const handleFileUpload = async (index, event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploadingFiles({ ...uploadingFiles, [index]: true });

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("vendorName", vendorName);

      const response = await fetch("/api/files/upload", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("Upload failed with status:", response.status, errorText);
        throw new Error(`Upload failed (${response.status}): ${errorText}`);
      }

      const data = await response.json();

      if (data.success) {
        // Update all fields at once to avoid state update issues
        const newConfigs = [...metafieldConfigs];
        newConfigs[index] = {
          ...newConfigs[index],
          value: data.file.shopifyFileId,
          fileName: data.file.filename,
          fileUrl: data.file.fileUrl,
        };
        setMetafieldConfigs(newConfigs);

        shopify.toast.show("File uploaded successfully");
      } else {
        throw new Error(data.error || "Upload failed");
      }
    } catch (error) {
      console.error("File upload error:", error);
      shopify.toast.show(`File upload failed: ${error.message}`, { isError: true });
    } finally {
      setUploadingFiles({ ...uploadingFiles, [index]: false });
    }
  };

  const handleSave = () => {
    saveMutation.mutate(metafieldConfigs);
  };

  const handleBulkApply = () => {
    setShowApplyModal(true);
  };

  const confirmBulkApply = () => {
    setShowApplyModal(false);
    applyMutation.mutate(selectedCategories);
  };

  const handleCategorySelect = (categoryName) => {
    const newSelected = new Set(selectedCategories);
    if (newSelected.has(categoryName)) {
      newSelected.delete(categoryName);
    } else {
      newSelected.add(categoryName);
    }
    setSelectedCategories(newSelected);
  };

  const handleSelectAll = () => {
    if (selectedCategories.size === categories.length) {
      setSelectedCategories(new Set());
    } else {
      setSelectedCategories(new Set(categories.map((cat) => cat.name)));
    }
  };

  const handleToggleCategory = (categoryName) => {
    const newExpanded = new Set(expandedCategories);
    if (newExpanded.has(categoryName)) {
      newExpanded.delete(categoryName);
    } else {
      newExpanded.add(categoryName);
    }
    setExpandedCategories(newExpanded);
  };

  if (vendorLoading) {
    return (
      <Page title={`Configure: ${vendorName}`} backAction={{ onAction: () => navigate("/vendors") }}>
        <Layout>
          <Layout.Section>
            <LegacyCard>
              <div style={{ textAlign: "center", padding: "2rem" }}>
                <Spinner size="large" />
              </div>
            </LegacyCard>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  if (!vendor) {
    return (
      <Page title="Vendor Not Found" backAction={{ onAction: () => navigate("/vendors") }}>
        <Layout>
          <Layout.Section>
            <Banner status="critical">
              <p>Vendor "{vendorName}" not found.</p>
            </Banner>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  return (
    <Page
      title={`Configure: ${vendorName}`}
      backAction={{ onAction: () => navigate("/vendors") }}
      secondaryActions={[
        {
          content: "Apply to Selected Categories",
          onAction: handleBulkApply,
          disabled: metafieldConfigs.length === 0 || !vendor.has_config || selectedCategories.size === 0,
          loading: applyMutation.isLoading,
        },
      ]}
    >
      <Layout>
        <Layout.Section>
          <LegacyCard sectioned>
            <VerticalStack gap={{xs: '2'}}>
                <p>
                  <strong>Products:</strong> {vendor.product_count || 0}
                </p>
                <p>
                  Configure metafields for this vendor. These will be automatically
                  applied to new products from this vendor.
                </p>
            </VerticalStack>
          </LegacyCard>
        </Layout.Section>

        <Layout.Section>
          <LegacyCard
            title="Vendor Metafields"
            sectioned
            actions={[
              {
                content: "Add Metafield",
                onAction: handleAddMetafield,
                disabled: definitions.length === 0,
              },
            ]}
          >
            <VerticalStack gap={{xs: '2'}}>
              {definitions.length === 0 && (
                <Banner status="warning">
                  <p>
                    No metafield definitions found. Please create product metafield definitions in
                    Shopify Admin (Settings → Custom data → Products).
                  </p>
                </Banner>
              )}

              {metafieldConfigs.length === 0 ? (
                <Banner status="info">
                  <p>No metafields configured. Click "Add Metafield" to get started.</p>
                </Banner>
              ) : (
                <VerticalStack gap={{xs: '2'}}>
                  {metafieldConfigs.map((config, index) => (
                    <LegacyCard key={index} sectioned>
                      <FormLayout>
                        <Select
                          label="Metafield Definition"
                          value={config.definitionId || ""}
                          options={[
                            { label: "-- Select a definition --", value: "" },
                            ...definitions.map((def) => ({
                              label: `${def.name} (${def.namespace}.${def.key})`,
                              value: def.id,
                            })),
                          ]}
                          onChange={(value) => handleSelectDefinition(index, value)}
                        />
                        {config.namespace && config.key && (
                          <LegacyStack>
                            <p style={{ fontSize: "0.875rem", color: "#6d7175" }}>
                              <strong>Type:</strong> {config.type || "Not set"}
                              <br />
                              <strong>Namespace:</strong> {config.namespace}
                              <br />
                              <strong>Key:</strong> {config.key}
                            </p>
                          </LegacyStack>
                        )}
                        {config.type === "file_reference" ? (
                          <VerticalStack>
                            <div>
                              <input
                                id={`file-upload-${index}`}
                                type="file"
                                style={{ display: "none" }}
                                onChange={(e) => handleFileUpload(index, e)}
                                accept="*/*"
                              />
                              <Button
                                loading={uploadingFiles[index]}
                                onClick={() => document.getElementById(`file-upload-${index}`).click()}
                              >
                                {uploadingFiles[index] ? "Uploading..." : config.fileName || "Upload File"}
                              </Button>
                            </div>
                            {config.fileName && (
                              <LegacyStack>
                                {/*<p style={{ fontSize: "0.875rem", color: "#008060", marginBottom: "8px" }}>*/}
                                {/*  ✓ {config.fileName}*/}
                                {/*</p>*/}
                                {config.fileUrl && (
                                  <div style={{ marginTop: "8px" }}>
                                    {config.fileUrl.match(/\.(jpg|jpeg|png|gif|webp)$/i) ||
                                     (config.fileName && config.fileName.match(/\.(jpg|jpeg|png|gif|webp)$/i)) ? (
                                      <img
                                        src={config.fileUrl}
                                        alt={config.fileName}
                                        style={{
                                          maxWidth: "200px",
                                          maxHeight: "200px",
                                          border: "1px solid #ddd",
                                          borderRadius: "4px",
                                          padding: "4px"
                                        }}
                                      />
                                    ) : (
                                      <a
                                        href={config.fileUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        style={{ fontSize: "0.875rem", color: "#005ea5", textDecoration: "underline" }}
                                      >
                                        View File
                                      </a>
                                    )}
                                  </div>
                                )}
                              </LegacyStack>
                            )}
                          </VerticalStack>
                        ) : (
                          <TextField
                            label="Value"
                            value={config.value}
                            onChange={(value) => handleMetafieldChange(index, "value", value)}
                            placeholder="Enter value"
                            multiline={config.type === "multi_line_text_field"}
                          />
                        )}
                        <Button
                          destructive
                          onClick={() => handleRemoveMetafield(index)}
                        >
                          Remove
                        </Button>
                      </FormLayout>
                    </LegacyCard>
                  ))}
                </VerticalStack>
              )}
              {metafieldConfigs.length > 0 && (
                <div style={{ marginTop: "16px" }}>
                  <Button
                    primary
                    onClick={handleSave}
                    loading={saveMutation.isLoading}
                  >
                    Save Configuration
                  </Button>
                </div>
              )}
            </VerticalStack>
          </LegacyCard>
        </Layout.Section>

        {applyResults && (
          <Layout.Section>
            <Banner
              title="Bulk Apply Results"
              status={applyResults.failed > 0 ? "warning" : "success"}
              onDismiss={() => setApplyResults(null)}
            >
              <p>
                Successfully applied to {applyResults.successful} of {applyResults.total} products.
                {applyResults.failed > 0 && ` ${applyResults.failed} failed.`}
              </p>
            </Banner>
          </Layout.Section>
        )}

        <Layout.Section>
          <LegacyCard title="Products Preview" sectioned>
            {productsLoading ? (
              <div style={{ textAlign: "center", padding: "2rem" }}>
                <Spinner />
              </div>
            ) : products.length === 0 ? (
              <Banner status="info">
                <p>No products found for this vendor.</p>
              </Banner>
            ) : (
              <VerticalStack gap={{xs: '2'}}>
                <Checkbox
                  label={`Select All Categories (${categories.length})`}
                  checked={selectedCategories.size === categories.length && categories.length > 0}
                  onChange={handleSelectAll}
                />
                {categories.map((category) => {
                  const isExpanded = expandedCategories.has(category.name);
                  const isSelected = selectedCategories.has(category.name);
                  return (
                    <div key={category.name} style={{ border: "1px solid #e1e3e5", borderRadius: "8px", padding: "12px" }}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "12px",
                          cursor: "pointer",
                        }}
                      >
                        <Checkbox
                          checked={isSelected}
                          onChange={() => handleCategorySelect(category.name)}
                        />
                        <div
                          onClick={() => handleToggleCategory(category.name)}
                          style={{
                              flex: 1,
                              gap: "8px",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: 'space-between',
                          }}
                        >
                          <span style={{
                              gap: "8px",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: 'space-between',
                          }}>
                              <span style={{ fontWeight: 600 }}>{category.name}</span>
                              <Badge>{category.count} products</Badge>
                          </span>
                          <span>
                              <Icon source={isExpanded ? ChevronUpIcon : ChevronDownIcon} />
                          </span>
                        </div>
                      </div>
                      <Collapsible
                        open={isExpanded}
                        id={`category-${category.name}`}
                        transition={{ duration: "200ms", timingFunction: "ease-in-out" }}
                      >
                        <div style={{ marginTop: "12px", paddingLeft: "32px" }}>
                          <VerticalStack gap={{xs: '2'}}>
                            {category.products.slice(0, 10).map((product) => (
                              <div
                                key={product.id}
                                style={{
                                  padding: "8px",
                                  borderBottom: "1px solid #f1f2f3",
                                  display: "flex",
                                  justifyContent: "space-between",
                                  alignItems: "center",
                                }}
                              >
                                <span>{product.title}</span>
                                <LegacyStack gap={{xs: '2'}}>
                                  <Badge status={product.status === "ACTIVE" ? "success" : undefined}>
                                    {product.status}
                                  </Badge>
                                  <Badge>{product.metafields?.edges?.length || 0} metafields</Badge>
                                </LegacyStack>
                              </div>
                            ))}
                            {category.products.length > 10 && (
                              <div style={{ padding: "8px", textAlign: "center", color: "#6d7175" }}>
                                Showing 10 of {category.products.length} products
                              </div>
                            )}
                          </VerticalStack>
                        </div>
                      </Collapsible>
                    </div>
                  );
                })}
              </VerticalStack>
            )}
          </LegacyCard>
        </Layout.Section>
      </Layout>

      <Modal
        open={showApplyModal}
        onClose={() => setShowApplyModal(false)}
        title="Confirm Bulk Apply"
        primaryAction={{
          content: "Apply to Selected",
          onAction: confirmBulkApply,
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: () => setShowApplyModal(false),
          },
        ]}
      >
        <Modal.Section>
          <LegacyStack>
            <p>
              This will apply the configured metafields to products in the following{" "}
              <strong>{selectedCategories.size}</strong> categories:
            </p>
            <ul style={{ marginTop: "8px", marginBottom: "12px" }}>
              {Array.from(selectedCategories).map((categoryName) => {
                const category = categories.find((cat) => cat.name === categoryName);
                return (
                  <li key={categoryName}>
                    <strong>{categoryName}</strong> ({category?.count || 0} products)
                  </li>
                );
              })}
            </ul>
            <p>
              <strong>Total products:</strong>{" "}
              {categories
                .filter((cat) => selectedCategories.has(cat.name))
                .reduce((sum, cat) => sum + cat.count, 0)}
            </p>
            <p style={{ marginTop: "12px" }}>
              This action cannot be undone. Are you sure you want to continue?
            </p>
          </LegacyStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}