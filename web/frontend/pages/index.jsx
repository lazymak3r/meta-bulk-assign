import {
    Page,
    Link,
    Text,
    Layout,
    Banner,
    Button,
    Spinner,
    LegacyCard,
    LegacyStack,
    VerticalStack,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useQuery } from "react-query";
import { useNavigate } from "react-router-dom";

export default function HomePage() {
  const navigate = useNavigate();

  const { data: vendorsData, isLoading } = useQuery({
    queryKey: ["vendors"],
    queryFn: async () => {
      const response = await fetch("/api/vendors");
      return await response.json();
    },
    refetchOnWindowFocus: false,
  });

  const vendors = vendorsData?.vendors || [];
  const unconfiguredVendors = vendors.filter((v) => !v.has_config);
  const totalProducts = vendors.reduce((sum, v) => sum + (v.product_count || 0), 0);

  return (
    <Page narrowWidth>
      <TitleBar title="Meta bulk assign" />
      <Layout>
        {isLoading && (
          <Layout.Section>
            <LegacyCard>
              <div style={{ textAlign: "center", padding: "2rem" }}>
                <Spinner size="small" />
              </div>
            </LegacyCard>
          </Layout.Section>
        )}

        {!isLoading && unconfiguredVendors.length > 0 && (
          <Layout.Section>
            <Banner
              title={`${unconfiguredVendors.length} vendor${unconfiguredVendors.length > 1 ? "s" : ""} need metafield configuration`}
              status="warning"
              action={{
                content: "Configure Vendors",
                onAction: () => navigate("/vendors"),
              }}
            >
              <p>
                Configure metafields for your vendors to automatically apply them to
                new products.
              </p>
              <p style={{ marginTop: "0.5rem" }}>
                <strong>Unconfigured vendors:</strong>{" "}
                {unconfiguredVendors.slice(0, 5).map((v) => v.vendor_name).join(", ")}
                {unconfiguredVendors.length > 5 && `, and ${unconfiguredVendors.length - 5} more`}
              </p>
            </Banner>
          </Layout.Section>
        )}

        {!isLoading && unconfiguredVendors.length === 0 && vendors.length > 0 && (
          <Layout.Section>
            <Banner title="All vendors configured!" status="success">
              <p>Great! All your vendors have metafield configurations set up.</p>
            </Banner>
          </Layout.Section>
        )}

        <Layout.Section>
          <LegacyCard sectioned>
            <VerticalStack gap={{xs: '2'}}>
              <Text as="h2" variant="headingMd">
                Welcome to Meta bulk assign
              </Text>
              <VerticalStack>
                <p>
                  Manage metafields for your products by vendor. This app allows you to:
                </p>
                <ul>
                  <li>Configure information for each vendor</li>
                  <li>Automatically apply metafields to new products</li>
                  <li>Bulk update existing products</li>
                  <li>Support multiple metafield types (text, numbers, dates, files)</li>
                </ul>
              </VerticalStack>
            </VerticalStack>
          </LegacyCard>
        </Layout.Section>

        {!isLoading && (
          <Layout.Section>
            <LegacyCard title="Overview" sectioned>
              <VerticalStack gap={{xs: '2'}}>
                <LegacyStack distribution="equalSpacing">
                  <VerticalStack>
                    <Text as="h3" variant="headingSm">
                      Total Vendors
                    </Text>
                    <Text as="p" variant="headingLg">
                      {vendors.length}
                    </Text>
                  </VerticalStack>
                  <VerticalStack>
                    <Text as="h3" variant="headingSm">
                      Configured
                    </Text>
                    <Text as="p" variant="headingLg">
                      {vendors.filter((v) => v.has_config).length}
                    </Text>
                  </VerticalStack>
                  <VerticalStack>
                    <Text as="h3" variant="headingSm">
                      Total Products
                    </Text>
                    <Text as="p" variant="headingLg">
                      {totalProducts}
                    </Text>
                  </VerticalStack>
                </LegacyStack>
                <div style={{ marginTop: "1rem" }}>
                  <Button primary onClick={() => navigate("/vendors")}>
                    Manage Vendors
                  </Button>
                </div>
              </VerticalStack>
            </LegacyCard>
          </Layout.Section>
        )}

        <Layout.Section>
          <LegacyCard title="Getting Started" sectioned>
            <VerticalStack gap={{xs: '2'}}>
              <VerticalStack>
                <p>
                  <strong>Step 1:</strong> Create metafield definitions in Shopify admin
                  (Settings → Custom data → Products)
                </p>
                <p>
                  <strong>Step 2:</strong> Go to the{" "}
                  <Link onClick={() => navigate("/vendors")}>Vendors page</Link> and configure
                  metafields for each vendor
                </p>
                <p>
                  <strong>Step 3:</strong> New products from configured vendors will
                  automatically receive the metafields
                </p>
                <p>
                  <strong>Step 4:</strong> Use "Apply to All Products" to bulk update existing
                  products
                </p>
              </VerticalStack>
            </VerticalStack>
          </LegacyCard>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
