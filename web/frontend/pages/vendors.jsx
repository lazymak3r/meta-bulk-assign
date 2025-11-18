import {
  Page,
  Layout,
  LegacyCard,
  DataTable,
  Badge,
  Button,
  Banner,
  Spinner,
} from "@shopify/polaris";
import { useNavigate } from "react-router-dom";
import { useQuery } from "react-query";

export default function Vendors() {
  const navigate = useNavigate();

  const {
    data: vendorsData,
    refetch,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["vendors"],
    queryFn: async () => {
      const response = await fetch("/api/vendors");
      return await response.json();
    },
    refetchOnWindowFocus: false,
  });

  const vendors = vendorsData?.vendors || [];

  const rows = vendors.map((vendor) => [
    vendor.vendor_name,
    vendor.product_count || 0,
    vendor.has_config ? (
      <Badge status="success">Configured</Badge>
    ) : (
      <Badge status="warning">Not Configured</Badge>
    ),
    <Button
      onClick={() => navigate(`/vendors/${encodeURIComponent(vendor.vendor_name)}`)}
    >
      {vendor.has_config ? "Edit Config" : "Configure"}
    </Button>,
  ]);

  const unconfiguredCount = vendors.filter((v) => !v.has_config).length;

  if (isLoading) {
    return (
      <Page title="Vendors">
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

  return (
    <Page
      title="Vendors"
      primaryAction={{
        content: "Refresh",
        onAction: refetch,
      }}
    >
      <Layout>
        {unconfiguredCount > 0 && (
          <Layout.Section>
            <Banner
              title={`${unconfiguredCount} vendor${unconfiguredCount > 1 ? "s" : ""} need${unconfiguredCount === 1 ? "s" : ""} metafield configuration`}
              status="warning"
            >
              <p>
                Configure metafields for vendors to automatically apply
                them to products.
              </p>
            </Banner>
          </Layout.Section>
        )}

        {error && (
          <Layout.Section>
            <Banner title="Error" status="critical">
              <p>{error.message || "An error occurred"}</p>
            </Banner>
          </Layout.Section>
        )}

        <Layout.Section>
          <LegacyCard>
            {vendors.length === 0 ? (
              <div style={{ padding: "2rem", textAlign: "center" }}>
                <p>No vendors found. Add products with vendors to get started.</p>
              </div>
            ) : (
              <DataTable
                columnContentTypes={["text", "numeric", "text", "text"]}
                headings={["Vendor", "Products", "Status", "Actions"]}
                rows={rows}
              />
            )}
          </LegacyCard>
        </Layout.Section>
      </Layout>
    </Page>
  );
}