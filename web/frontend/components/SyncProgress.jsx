import { useState } from "react";
import {
  LegacyCard,
  ProgressBar,
  Text,
  Button,
  Collapsible,
  VerticalStack,
  HorizontalStack,
  Badge,
  DataTable,
} from "@shopify/polaris";

const STATUS_BADGES = {
  pending: { children: "Pending", tone: "attention" },
  running: { children: "Running", tone: "info" },
  completed: { children: "Completed", tone: "success" },
  failed: { children: "Failed", tone: "critical" },
  cancelled: { children: "Cancelled", tone: "warning" },
};

export function SyncProgress({ job, onCancel, onRefresh }) {
  const [errorsOpen, setErrorsOpen] = useState(false);

  if (!job) return null;

  const {
    status,
    total_products = 0,
    processed_products = 0,
    successful_products = 0,
    failed_products = 0,
    skipped_products = 0,
    total_files_uploaded = 0,
    total_files_skipped = 0,
    errors = [],
    started_at,
    completed_at,
  } = job;

  const progress = total_products > 0
    ? Math.round((processed_products / total_products) * 100)
    : 0;

  const matchedProducts = successful_products + failed_products;

  const isActive = status === "running" || status === "pending";
  const badgeProps = STATUS_BADGES[status] || { children: status };

  return (
    <LegacyCard title="Sync Status" sectioned>
      <VerticalStack gap="4">
        <HorizontalStack align="space-between" blockAlign="center">
          <Badge {...badgeProps} />
          <HorizontalStack gap="2">
            {isActive && onCancel && (
              <Button tone="critical" onClick={onCancel} size="slim">
                Cancel
              </Button>
            )}
            {!isActive && onRefresh && (
              <Button onClick={onRefresh} size="slim">
                Refresh
              </Button>
            )}
          </HorizontalStack>
        </HorizontalStack>

        {(total_products > 0 || isActive) && (
          <>
            <ProgressBar progress={progress} size="small" tone={isActive ? undefined : "success"} />
            <Text as="p" variant="bodySm" tone="subdued">
              Scanned {processed_products}{total_products > 0 ? ` / ${total_products}` : ""} products ({progress}%)
              {matchedProducts > 0 && ` — ${matchedProducts} matched with source data`}
            </Text>
          </>
        )}

        <HorizontalStack gap="4" wrap>
          <StatBlock label="Matched" value={matchedProducts} />
          <StatBlock label="Successful" value={successful_products} />
          <StatBlock label="Failed" value={failed_products} />
          <StatBlock label="Files Uploaded" value={total_files_uploaded} />
          <StatBlock label="Files Cached" value={total_files_skipped} />
        </HorizontalStack>

        {started_at && (
          <Text as="p" variant="bodySm" tone="subdued">
            Started: {new Date(started_at).toLocaleString()}
            {completed_at && ` — Completed: ${new Date(completed_at).toLocaleString()}`}
          </Text>
        )}

        {errors.length > 0 && (
          <VerticalStack gap="2">
            <Button
              onClick={() => setErrorsOpen(!errorsOpen)}
              plain
              size="slim"
            >
              {errorsOpen ? "Hide" : "Show"} {errors.length} error{errors.length !== 1 ? "s" : ""}
            </Button>
            <Collapsible open={errorsOpen}>
              <DataTable
                columnContentTypes={["text", "text"]}
                headings={["Product", "Error"]}
                rows={errors.slice(0, 50).map((e) => [
                  e.productTitle || e.productId || "Unknown",
                  e.error,
                ])}
              />
              {errors.length > 50 && (
                <Text as="p" variant="bodySm" tone="subdued">
                  ... and {errors.length - 50} more errors
                </Text>
              )}
            </Collapsible>
          </VerticalStack>
        )}
      </VerticalStack>
    </LegacyCard>
  );
}

function StatBlock({ label, value }) {
  return (
    <VerticalStack gap="1">
      <Text as="p" variant="headingMd" alignment="center">
        {value}
      </Text>
      <Text as="p" variant="bodySm" tone="subdued" alignment="center">
        {label}
      </Text>
    </VerticalStack>
  );
}
