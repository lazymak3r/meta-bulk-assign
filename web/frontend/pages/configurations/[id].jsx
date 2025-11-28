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
    Checkbox,
    Select,
} from "@shopify/polaris";
import {TitleBar} from "@shopify/app-bridge-react";
import {useNavigate, useParams} from "react-router-dom";
import {useQuery, useQueryClient} from "react-query";
import {ConfigurationGraphBuilder} from "../../components/ConfigurationGraphBuilder/ConfigurationGraphBuilder";
import {ProductPreview} from "../../components/ProductPreview/ProductPreview";
import {MetafieldConfigEditor} from "../../components/MetafieldConfigEditor";
import {useAuthenticatedFetch} from "../../hooks";

export default function EditConfiguration() {
    const {id} = useParams();
    const navigate = useNavigate();
    const fetch = useAuthenticatedFetch();
    const queryClient = useQueryClient();

    const [name, setName] = useState("");
    const [rules, setRules] = useState([]);
    const [metafieldConfigs, setMetafieldConfigs] = useState([]);
    const [isSaving, setIsSaving] = useState(false);
    const [isApplying, setIsApplying] = useState(false);
    const [error, setError] = useState(null);
    const [applyResult, setApplyResult] = useState(null);
    const [showOnStorefront, setShowOnStorefront] = useState(false);
    const [storefrontPosition, setStorefrontPosition] = useState("after_price");

    // Fetch configuration
    const {data: configData, isLoading: loadingConfig} = useQuery({
        queryKey: ["configuration", id],
        queryFn: async () => {
            const response = await fetch(`/api/configurations/${id}`);
            if (!response.ok) {
                throw new Error("Failed to load configuration");
            }
            return await response.json();
        },
        refetchOnWindowFocus: false,
    });

    // Initialize form when data loads
    useEffect(() => {
        if (configData) {
            setName(configData.name || "");

            // Convert snake_case to camelCase for frontend compatibility
            const convertedRules = (configData.rules || []).map(rule => ({
                id: rule.id,
                ruleType: rule.rule_type,
                ruleValue: rule.rule_value,
                ruleId: rule.rule_id,
                parentId: rule.parent_id,
                operator: rule.operator,
                level: rule.level,
                position: rule.position,
            }));
            setRules(convertedRules);

            setMetafieldConfigs(configData.metafield_configs || []);
            setShowOnStorefront(configData.show_on_storefront || false);
            setStorefrontPosition(configData.storefront_position || "after_price");
        }
    }, [configData]);

    // Fetch vendors, collections, categories, metafield definitions
    const {data: vendorsData} = useQuery({
        queryKey: ["vendors"],
        queryFn: async () => {
            const response = await fetch("/api/products/vendors");
            if (!response.ok) {
                return {vendors: []};
            }
            return await response.json();
        },
        refetchOnWindowFocus: false,
    });

    const {data: collectionsData} = useQuery({
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

    const {data: categoriesData} = useQuery({
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

    const {data: productsData} = useQuery({
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

    const {data: metafieldDefsData} = useQuery({
        queryKey: ["metafield-definitions"],
        queryFn: async () => {
            const response = await fetch("/api/metafield-definitions");
            return await response.json();
        },
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
            const response = await fetch(`/api/configurations/${id}`, {
                method: "PUT",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({
                    name: name || null,
                    metafieldConfigs,
                    rules,
                    showOnStorefront,
                    storefrontPosition,
                }),
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || "Failed to update configuration");
            }

            // Invalidate configurations cache so the list updates
            queryClient.invalidateQueries(["configurations"]);

            navigate("/");
        } catch (err) {
            console.error("Error updating configuration:", err);
            setError(err.message);
        } finally {
            setIsSaving(false);
        }
    }, [id, name, metafieldConfigs, rules, showOnStorefront, storefrontPosition, fetch, navigate, queryClient]);

    const handleApply = useCallback(async () => {
        setIsApplying(true);
        setError(null);
        setApplyResult(null);

        try {
            const response = await fetch(`/api/configurations/${id}/apply`, {
                method: "POST",
                headers: {"Content-Type": "application/json"},
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || "Failed to apply configuration");
            }

            const result = await response.json();
            setApplyResult(result);
        } catch (err) {
            console.error("Error applying configuration:", err);
            setError(err.message);
        } finally {
            setIsApplying(false);
        }
    }, [id, fetch]);

    const handleCancel = useCallback(() => {
        navigate("/");
    }, [navigate]);

    const isLoading = loadingConfig;

    return (
        <Page
            backAction={{content: "Configurations", onAction: handleCancel}}
            title={`Edit Configuration${configData?.name ? `: ${configData.name}` : ""}`}
            primaryAction={{
                content: "Save Configuration",
                onAction: handleSave,
                loading: isSaving,
                disabled: metafieldConfigs.length === 0 || isApplying,
            }}
            secondaryActions={[
                {
                    content: "Apply to Products",
                    onAction: handleApply,
                    loading: isApplying,
                    disabled: isSaving,
                },
                {
                    content: "Cancel",
                    onAction: handleCancel,
                    disabled: isSaving || isApplying,
                },
            ]}
        >
            <TitleBar title={`Edit Configuration${configData?.name ? `: ${configData.name}` : ""}`}/>

            <Layout>
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
                                Applied to {applyResult.successful} of {applyResult.total} products.
                            </p>
                            {applyResult.failed > 0 && (
                                <p>{applyResult.failed} products failed to update.</p>
                            )}
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
                            <LegacyCard sectioned title="Storefront Display">
                                <VerticalStack gap="4">
                                    <Checkbox
                                        label="Show on storefront"
                                        checked={showOnStorefront}
                                        onChange={setShowOnStorefront}
                                        helpText="Automatically display these metafields on product pages"
                                    />
                                    {showOnStorefront && (
                                        <Select
                                            label="Display position"
                                            options={[
                                                {label: "After price", value: "after_price"},
                                                {label: "Before add to cart button", value: "before_cart"},
                                                {label: "After product description", value: "after_description"},
                                                {label: "After product title", value: "after_title"},
                                            ]}
                                            value={storefrontPosition}
                                            onChange={setStorefrontPosition}
                                            helpText="Where to display the metafields on the product page"
                                        />
                                    )}
                                </VerticalStack>
                            </LegacyCard>
                        </Layout.Section>

                        <Layout.Section>
                            <LegacyCard sectioned>
                                <VerticalStack gap="4">
                                    <MetafieldConfigEditor
                                        metafieldConfigs={metafieldConfigs}
                                        onChange={setMetafieldConfigs}
                                        metafieldDefinitions={metafieldDefinitions}
                                    />
                                </VerticalStack>
                            </LegacyCard>
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
                            <ProductPreview rules={rules} />
                        </Layout.Section>
                    </>
                )}
            </Layout>
        </Page>
    );
}
