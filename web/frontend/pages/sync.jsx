import { useState, useCallback, useRef } from "react";
import {
  Page,
  Layout,
  LegacyCard,
  DataTable,
  Badge,
  Button,
  Banner,
  Spinner,
  EmptyState,
  Text,
  VerticalStack,
  HorizontalStack,
} from "@shopify/polaris";
import { DeleteIcon, EditIcon } from "@shopify/polaris-icons";
import { TitleBar } from "@shopify/app-bridge-react";
import { useQuery, useMutation, useQueryClient } from "react-query";
import { useAuthenticatedFetch } from "../hooks";
import { SyncMappingEditor } from "../components/SyncMappingEditor";
import { SyncProgress } from "../components/SyncProgress";

const DISPLAY_TYPE_LABELS = {
  warranty_document: "Warranty Document",
  safety_document: "Safety Document",
  product_detail_icon: "Product Detail Icon",
};

export default function SyncPage() {
  const authenticatedFetch = useAuthenticatedFetch();
  const queryClient = useQueryClient();

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingMapping, setEditingMapping] = useState(null);
  const [error, setError] = useState(null);
  const [activeJob, setActiveJob] = useState(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const cursorRef = useRef(null);
  const cancelledRef = useRef(false);

  // Fetch mappings
  const {
    data: mappings = [],
    isLoading: loadingMappings,
  } = useQuery({
    queryKey: ["sync-mappings"],
    queryFn: async () => {
      const response = await authenticatedFetch("/api/sync/mappings");
      if (!response.ok) throw new Error("Failed to fetch mappings");
      return response.json();
    },
    refetchOnWindowFocus: false,
  });

  // Fetch latest job (on mount only)
  const {
    data: latestJob,
  } = useQuery({
    queryKey: ["sync-job-latest"],
    queryFn: async () => {
      const response = await authenticatedFetch("/api/sync/jobs/latest");
      if (!response.ok) throw new Error("Failed to fetch job");
      return response.json();
    },
    refetchOnWindowFocus: false,
  });

  // Drive the batch processing loop
  const processBatches = useCallback(async (jobId) => {
    setIsSyncing(true);
    cursorRef.current = null;
    cancelledRef.current = false;
    let hasMore = true;

    while (hasMore && !cancelledRef.current) {
      try {
        const response = await authenticatedFetch(`/api/sync/jobs/${jobId}/process-batch`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cursor: cursorRef.current }),
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || "Batch processing failed");
        }

        const data = await response.json();
        setActiveJob(data.job);
        hasMore = data.hasMore;
        cursorRef.current = data.nextCursor;

        if (data.job.status === "cancelled") {
          break;
        }
      } catch (err) {
        console.error("Batch processing error:", err);
        setError(err.message);
        break;
      }
    }

    setIsSyncing(false);
    queryClient.invalidateQueries(["sync-job-latest"]);
  }, [authenticatedFetch, queryClient]);

  // Start sync mutation
  const startSyncMutation = useMutation({
    mutationFn: async () => {
      const response = await authenticatedFetch("/api/sync/start", {
        method: "POST",
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to start sync");
      }
      return response.json();
    },
    onSuccess: (data) => {
      setActiveJob({ id: data.jobId, status: "running" });
      setError(null);
      processBatches(data.jobId);
    },
    onError: (err) => {
      setError(err.message);
    },
  });

  // Delete mapping mutation
  const deleteMappingMutation = useMutation({
    mutationFn: async (id) => {
      setDeletingId(id);
      const response = await authenticatedFetch(`/api/sync/mappings/${id}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error("Failed to delete mapping");
      return response.json();
    },
    onSuccess: () => {
      setDeletingId(null);
      queryClient.invalidateQueries(["sync-mappings"]);
    },
    onError: (err) => {
      setDeletingId(null);
      setError(err.message);
    },
  });

  // Cancel job
  const handleCancel = useCallback(async () => {
    const jobId = activeJob?.id || latestJob?.id;
    if (!jobId) return;

    cancelledRef.current = true;

    try {
      const response = await authenticatedFetch(`/api/sync/jobs/${jobId}/cancel`, {
        method: "POST",
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to cancel");
      }
    } catch (err) {
      setError(err.message);
    }
  }, [activeJob, latestJob, authenticatedFetch]);

  const handleEditorSave = useCallback(() => {
    setEditorOpen(false);
    setEditingMapping(null);
    queryClient.invalidateQueries(["sync-mappings"]);
  }, [queryClient]);

  const handleEditMapping = useCallback((mapping) => {
    setEditingMapping(mapping);
    setEditorOpen(true);
  }, []);

  const handleAddMapping = useCallback(() => {
    setEditingMapping(null);
    setEditorOpen(true);
  }, []);

  // Determine which job to show
  const displayJob = activeJob || latestJob;
  const isRunning = isSyncing || displayJob?.status === "running" || displayJob?.status === "pending";

  // Build mapping table rows
  const mappingRows = mappings.map((m) => [
    `${m.source_namespace}.${m.source_key}`,
    DISPLAY_TYPE_LABELS[m.target_display_type] || m.target_display_type,
    `${m.target_namespace}.${m.target_key}`,
    m.enabled ? <Badge tone="success">Enabled</Badge> : <Badge>Disabled</Badge>,
    <HorizontalStack gap="2">
      <Button
        icon={EditIcon}
        size="slim"
        onClick={() => handleEditMapping(m)}
        accessibilityLabel="Edit"
      />
      <Button
        icon={DeleteIcon}
        size="slim"
        tone="critical"
        onClick={() => deleteMappingMutation.mutate(m.id)}
        loading={deletingId === m.id}
        accessibilityLabel="Delete"
      />
    </HorizontalStack>,
  ]);

  return (
    <Page>
      <TitleBar title="File Sync" />
      <Layout>
        {error && (
          <Layout.Section>
            <Banner tone="critical" onDismiss={() => setError(null)}>
              {error}
            </Banner>
          </Layout.Section>
        )}

        {isRunning && (
          <Layout.Section>
            <Banner tone="info">
              A sync job is currently running. You can track progress below.
            </Banner>
          </Layout.Section>
        )}

        {/* Sync Status */}
        {displayJob && (
          <Layout.Section>
            <SyncProgress
              job={displayJob}
              onCancel={isRunning ? handleCancel : undefined}
              onRefresh={() => queryClient.invalidateQueries(["sync-job-latest"])}
            />
          </Layout.Section>
        )}

        {/* Mappings */}
        <Layout.Section>
          <LegacyCard
            title="Sync Mappings"
            actions={[{ content: "Add Mapping", onAction: handleAddMapping }]}
          >
            {loadingMappings ? (
              <LegacyCard.Section>
                <HorizontalStack align="center">
                  <Spinner size="small" />
                </HorizontalStack>
              </LegacyCard.Section>
            ) : mappings.length === 0 ? (
              <LegacyCard.Section>
                <EmptyState
                  heading="No sync mappings configured"
                  action={{ content: "Add Mapping", onAction: handleAddMapping }}
                >
                  <p>
                    Configure which middleware-imported metafields should be
                    transformed into Shopify file references for storefront display.
                  </p>
                </EmptyState>
              </LegacyCard.Section>
            ) : (
              <DataTable
                columnContentTypes={["text", "text", "text", "text", "text"]}
                headings={["Source Metafield", "Display Type", "Target Metafield", "Status", "Actions"]}
                rows={mappingRows}
              />
            )}
          </LegacyCard>
        </Layout.Section>

        {/* Sync Actions */}
        <Layout.Section>
          <LegacyCard title="Sync Actions" sectioned>
            <VerticalStack gap="3">
              <Text as="p" variant="bodyMd">
                Start a sync to scan all products, download external files from
                source metafields, upload them to Shopify Files, and set the
                proper file reference metafields.
              </Text>
              <HorizontalStack gap="3">
                <Button
                  primary
                  onClick={() => startSyncMutation.mutate()}
                  loading={startSyncMutation.isLoading}
                  disabled={isRunning || mappings.length === 0}
                >
                  Start Sync
                </Button>
              </HorizontalStack>
              {mappings.length === 0 && (
                <Text as="p" variant="bodySm" tone="subdued">
                  Add at least one mapping before starting a sync.
                </Text>
              )}
            </VerticalStack>
          </LegacyCard>
        </Layout.Section>
      </Layout>

      <SyncMappingEditor
        open={editorOpen}
        onClose={() => {
          setEditorOpen(false);
          setEditingMapping(null);
        }}
        onSave={handleEditorSave}
        editingMapping={editingMapping}
      />
    </Page>
  );
}
