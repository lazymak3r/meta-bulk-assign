import {useState, useCallback, useEffect} from "react";
import {
    Page,
    Layout,
    LegacyCard,
    VerticalStack,
    TextField,
    Button,
    Banner,
    Spinner,
    HorizontalStack,
} from "@shopify/polaris";
import {TitleBar} from "@shopify/app-bridge-react";
import {useNavigate} from "react-router-dom";
import {useQuery, useQueryClient} from "react-query";
import {ConfigurationGraphBuilder} from "../../components/ConfigurationGraphBuilder/ConfigurationGraphBuilder";
import {ProductPreview} from "../../components/ProductPreview/ProductPreview";
import {MetafieldConfigEditor} from "../../components/MetafieldConfigEditor";
import {useAuthenticatedFetch} from "../../hooks";

export default function NewConfiguration() {
    const navigate = useNavigate();
    const fetch = useAuthenticatedFetch();
    const queryClient = useQueryClient();

    const [name, setName] = useState("");
    const [rules, setRules] = useState([]);
    const [metafieldConfigs, setMetafieldConfigs] = useState([]);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState(null);

    // Fetch vendors
    const {data: vendorsData, isLoading: loadingVendors} = useQuery({
        queryKey: ["vendors"],
        queryFn: async () => {
            const response = await fetch("/api/products/vendors");
            if (!response.ok) {
                // If endpoint doesn't exist, fetch products and extract vendors
                const productsRes = await fetch("/api/products/count");
                return {vendors: []};
            }
            return await response.json();
        },
        refetchOnWindowFocus: false,
    });

    // Fetch collections
    const {data: collectionsData, isLoading: loadingCollections} = useQuery({
        queryKey: ["collections"],
        queryFn: async () => {
            const response = await fetch("/api/collections");
            if (!response.ok) {
                return {collections: []};
            }
            return await response.json();
        },
        refetchOnWindowFocus: false,
    });

    // Fetch categories
    const {data: categoriesData, isLoading: loadingCategories} = useQuery({
        queryKey: ["categories"],
        queryFn: async () => {
            const response = await fetch("/api/categories");
            if (!response.ok) {
                return {categories: []};
            }
            return await response.json();
        },
        refetchOnWindowFocus: false,
    });

    // Fetch products
    const {data: productsData, isLoading: loadingProducts} = useQuery({
        queryKey: ["products"],
        queryFn: async () => {
            const response = await fetch("/api/products");
            if (!response.ok) {
                return {products: []};
            }
            return await response.json();
        },
        refetchOnWindowFocus: false,
    });

    // Fetch metafield definitions
    const {data: metafieldDefsData, isLoading: loadingMetafields} = useQuery({
        queryKey: ["metafield-definitions"],
        queryFn: async () => {
            const response = await fetch("/api/metafield-definitions");
            return await response.json();
        },
        refetchOnWindowFocus: false,
    });

    const vendors = vendorsData?.vendors || [];
    const collections = collectionsData?.collections || [];
    const categories = categoriesData?.categories || [];
    const products = productsData?.products || [];
    const metafieldDefinitions = metafieldDefsData?.definitions || [];

    const handleSave = useCallback(async () => {
        if (metafieldConfigs.length === 0) {
            setError("Please add at least one metafield configuration");
            return;
        }

        setIsSaving(true);
        setError(null);

        try {
            const response = await fetch("/api/configurations", {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({
                    name: name || null,
                    metafieldConfigs,
                    rules,
                    priority: 0,
                }),
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || "Failed to create configuration");
            }

            const data = await response.json();

            // Invalidate configurations cache so the list updates
            queryClient.invalidateQueries(["configurations"]);

            navigate("/");
        } catch (err) {
            console.error("Error creating configuration:", err);
            setError(err.message);
        } finally {
            setIsSaving(false);
        }
    }, [name, metafieldConfigs, rules, fetch, navigate, queryClient]);

    const handleCancel = useCallback(() => {
        navigate("/");
    }, [navigate]);

    const isLoading = loadingVendors || loadingCollections || loadingCategories || loadingProducts || loadingMetafields;

    return (
        <Page
            backAction={{content: "Configurations", onAction: handleCancel}}
            title="Add Configuration"
            primaryAction={{
                content: "Save Configuration",
                onAction: handleSave,
                loading: isSaving,
                disabled: metafieldConfigs.length === 0,
            }}
            secondaryActions={[
                {
                    content: "Cancel",
                    onAction: handleCancel,
                    disabled: isSaving,
                },
            ]}
        >
            <TitleBar title="Add Configuration"/>

            <Layout>
                {error && (
                    <Layout.Section>
                        <Banner tone="critical" onDismiss={() => setError(null)}>
                            {error}
                        </Banner>
                    </Layout.Section>
                )}

                {isLoading ? (
                    <Layout.Section>
                        <LegacyCard sectioned>
                            <div style={{textAlign: "center", padding: "2rem"}}>
                                <Spinner size="small"/>
                            </div>
                        </LegacyCard>
                    </Layout.Section>
                ) : (
                    <>
                        <Layout.Section>
                            <LegacyCard sectioned>
                                <VerticalStack gap="4">
                                    <TextField
                                        label="Configuration Name (Optional)"
                                        value={name}
                                        onChange={setName}
                                        placeholder="e.g., Summer Collection Warranty"
                                        helpText="If left empty, a name will be auto-generated based on your rules"
                                        autoComplete="off"
                                    />
                                </VerticalStack>
                            </LegacyCard>
                        </Layout.Section>

                        <Layout.Section>
                            <VerticalStack gap="4">
                                <LegacyCard sectioned>
                                    <VerticalStack gap="4">
                                        <MetafieldConfigEditor
                                            metafieldConfigs={metafieldConfigs}
                                            onChange={setMetafieldConfigs}
                                            metafieldDefinitions={metafieldDefinitions}
                                        />
                                    </VerticalStack>
                                </LegacyCard>
                            </VerticalStack>
                        </Layout.Section>

                        <Layout.Section>
                            <ConfigurationGraphBuilder
                                initialRules={rules}
                                onChange={setRules}
                                vendors={vendors}
                                collections={collections}
                                categories={categories}
                                products={products}
                            />
                        </Layout.Section>

                        <Layout.Section>
                            <ProductPreview rules={rules}/>
                        </Layout.Section>
                    </>
                )}
            </Layout>
        </Page>
    );
}
