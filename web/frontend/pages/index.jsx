import { useState, useCallback } from "react";
import {
  Page,
  Layout,
  LegacyCard,
  DataTable,
  Badge,
  Button,
  HorizontalStack,
  Banner,
  Spinner,
  EmptyState,
  Popover,
  ActionList,
  Text,
} from "@shopify/polaris";
import { MenuVerticalIcon } from "@shopify/polaris-icons";
import { TitleBar } from "@shopify/app-bridge-react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "react-query";
import { PriorityEditor } from "../components/PriorityEditor/PriorityEditor";
import { useAuthenticatedFetch } from "../hooks";

export default function HomePage() {
  const navigate = useNavigate();
  const authenticatedFetch = useAuthenticatedFetch();
  const queryClient = useQueryClient();

  const [applyingId, setApplyingId] = useState(null);
  const [duplicatingId, setDuplicatingId] = useState(null);
  const [applyResult, setApplyResult] = useState(null);
  const [error, setError] = useState(null);
  const [activePopover, setActivePopover] = useState(null);

  // Fetch configurations
  const {
    data: configurationsData,
    isLoading,
    isRefetching,
    refetch,
  } = useQuery({
    queryKey: ["configurations"],
    queryFn: async () => {
      const response = await authenticatedFetch("/api/configurations");
      if (!response.ok) {
        throw new Error("Failed to fetch configurations");
      }
      return await response.json();
    },
    refetchOnWindowFocus: false,
  });

  const configurations = configurationsData || [];

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      const response = await authenticatedFetch(`/api/configurations/${id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        throw new Error("Failed to delete configuration");
      }
      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries(["configurations"]);
    },
    onError: (err) => {
      setError(err.message);
    },
  });

  // Duplicate mutation
  const duplicateMutation = useMutation({
    mutationFn: async (id) => {
      const response = await authenticatedFetch(`/api/configurations/${id}/duplicate`, {
        method: "POST",
      });
      if (!response.ok) {
        throw new Error("Failed to duplicate configuration");
      }
      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries(["configurations"]);
      setDuplicatingId(null);
    },
    onError: (err) => {
      setError(err.message);
      setDuplicatingId(null);
    },
  });

  // Apply configuration
  const handleApply = useCallback(
    async (id) => {
      setApplyingId(id);
      setError(null);
      setApplyResult(null);

      try {
        const response = await authenticatedFetch(`/api/configurations/${id}/apply`, {
          method: "POST",
        });

        if (!response.ok) {
          throw new Error("Failed to apply configuration");
        }

        const result = await response.json();
        setApplyResult(result);
      } catch (err) {
        setError(err.message);
      } finally {
        setApplyingId(null);
      }
    },
    [authenticatedFetch]
  );

  // Update priority
  const handlePriorityUpdate = useCallback(
    async (id, newPriority) => {
      try {
        const response = await authenticatedFetch(`/api/configurations/priorities`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            priorities: [{ id, priority: newPriority }],
          }),
        });

        if (!response.ok) {
          throw new Error("Failed to update priority");
        }

        queryClient.invalidateQueries(["configurations"]);
      } catch (err) {
        setError(err.message);
        throw err;
      }
    },
    [authenticatedFetch, queryClient]
  );

  const handleDelete = useCallback(
    (id) => {
      if (confirm("Are you sure you want to delete this configuration?")) {
        deleteMutation.mutate(id);
      }
    },
    [deleteMutation]
  );

  const handleDuplicate = useCallback(
    (id) => {
      setDuplicatingId(id);
      duplicateMutation.mutate(id);
    },
    [duplicateMutation]
  );

  const handleEdit = useCallback(
    (id) => {
      navigate(`/configurations/${id}`);
    },
    [navigate]
  );

  const handleAddNew = useCallback(() => {
    navigate("/configurations/new");
  }, [navigate]);

  // Build table rows
  const rows = configurations.map((config) => {
    const typeBadgeColors = {
      vendor: "info",
      category: "warning",
      collection: "success",
      product: "attention",
      combined: "default",
    };

    return [
      config.name || "(Auto-generated)",
      <Badge tone={typeBadgeColors[config.type] || "default"} key={`type-${config.id}`}>
        {config.type.charAt(0).toUpperCase() + config.type.slice(1)}
      </Badge>,
      <PriorityEditor
        key={`priority-${config.id}`}
        priority={config.priority}
        configId={config.id}
        onSave={handlePriorityUpdate}
      />,
      config.ruleCount || 0,
      <Popover
        key={`actions-${config.id}`}
        active={activePopover === config.id}
        activator={
          <Button
            onClick={() => setActivePopover(activePopover === config.id ? null : config.id)}
            icon={MenuVerticalIcon}
            accessibilityLabel="Actions"
          />
        }
        onClose={() => setActivePopover(null)}
      >
        <ActionList
          items={[
            {
              content: "Edit",
              onAction: () => {
                setActivePopover(null);
                handleEdit(config.id);
              },
            },
            {
              content: applyingId === config.id ? "Applying..." : "Apply",
              onAction: () => {
                setActivePopover(null);
                handleApply(config.id);
              },
              disabled: applyingId === config.id,
            },
            {
              content: duplicatingId === config.id ? "Duplicating..." : "Duplicate",
              onAction: () => {
                setActivePopover(null);
                handleDuplicate(config.id);
              },
              disabled: duplicatingId === config.id,
            },
            {
              content: "Delete",
              destructive: true,
              onAction: () => {
                setActivePopover(null);
                handleDelete(config.id);
              },
            },
          ]}
        />
      </Popover>,
    ];
  });

  return (
    <Page
      title="My Configurations"
      primaryAction={{
        content: "Add Configuration",
        onAction: handleAddNew,
      }}
    >
      <TitleBar title="My Configurations" />

      <Layout>
        {applyingId && (
          <Layout.Section>
            <Banner>
              <HorizontalStack gap="2" align="start">
                <Spinner size="small" />
                <Text as="span">Applying configuration to products...</Text>
              </HorizontalStack>
            </Banner>
          </Layout.Section>
        )}

        {duplicatingId && (
          <Layout.Section>
            <Banner>
              <HorizontalStack gap="2" align="start">
                <Spinner size="small" />
                <Text as="span">Duplicating configuration...</Text>
              </HorizontalStack>
            </Banner>
          </Layout.Section>
        )}

        {isRefetching && (
          <Layout.Section>
            <Banner>
              <HorizontalStack gap="2" align="start">
                <Spinner size="small" />
                <Text as="span">Loading configurations...</Text>
              </HorizontalStack>
            </Banner>
          </Layout.Section>
        )}

        {error && (
          <Layout.Section>
            <Banner tone="critical" onDismiss={() => setError(null)}>
              {error}
            </Banner>
          </Layout.Section>
        )}

        {applyResult && (
          <Layout.Section>
            <Banner
              tone={applyResult.failed === 0 ? "success" : "warning"}
              onDismiss={() => setApplyResult(null)}
            >
              <p>
                Applied to {applyResult.successful} of {applyResult.total}{" "}
                products.
              </p>
              {applyResult.failed > 0 && (
                <p>{applyResult.failed} products failed to update.</p>
              )}
            </Banner>
          </Layout.Section>
        )}

        <Layout.Section>
          {isLoading ? (
            <LegacyCard sectioned>
              <div style={{ textAlign: "center", padding: "2rem" }}>
                <Spinner size="small" />
              </div>
            </LegacyCard>
          ) : configurations.length === 0 ? (
            <EmptyState
              heading="No configurations yet"
              action={{
                content: "Add Configuration",
                onAction: handleAddNew,
              }}
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
            >
              <p>
                Create your first configuration to automatically apply metafields
                to products based on vendor, collection, category, or product
                rules.
              </p>
            </EmptyState>
          ) : (
            <LegacyCard sectioned>
              <DataTable
                columnContentTypes={["text", "text", "text", "numeric", "text"]}
                headings={["Name", "Type", "Priority", "Rules", "Actions"]}
                rows={rows}
              />
            </LegacyCard>
          )}
        </Layout.Section>

        {configurations.length > 0 && (
          <Layout.Section>
            <LegacyCard sectioned>
              <div style={{ padding: "1rem" }}>
                <p style={{ marginBottom: "0.5rem" }}>
                  <strong>About Configuration Priority:</strong>
                </p>
                <p>
                  When a new product is created, all matching configurations are
                  applied in order of priority (highest first). Higher priority
                  configurations will be applied before lower priority ones.
                </p>
              </div>
            </LegacyCard>
          </Layout.Section>
        )}
      </Layout>
    </Page>
  );
}
