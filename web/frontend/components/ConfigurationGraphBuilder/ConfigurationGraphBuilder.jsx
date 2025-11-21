import {useState, useCallback, useEffect, Fragment} from "react";
import {
    LegacyCard,
    VerticalStack,
    HorizontalStack,
    Button,
    Text,
    Box,
    Icon,
} from "@shopify/polaris";
import {PlusIcon, ExitIcon, MaximizeIcon, MinimizeIcon} from "@shopify/polaris-icons";
import {RuleNode} from "../RuleNode/RuleNode";
import "./ConfigurationGraphBuilder.css";

/**
 * Graph builder component for creating AND/OR rule trees
 * Horizontal layout = OR logic
 * Vertical layout = AND logic
 */
export function ConfigurationGraphBuilder({
                                              initialRules = [],
                                              onChange,
                                              vendors = [],
                                              collections = [],
                                              categories = [],
                                              products = [],
                                          }) {
    // Use initialRules directly (controlled component)
    const rules = initialRules;

    // Fullscreen state
    const [isFullscreen, setIsFullscreen] = useState(false);

    // Calculate next ID based on current rules
    const getNextId = useCallback(() => {
        if (rules.length === 0) return 1;
        const maxId = Math.max(
            ...rules.map(r => {
                const match = r.id?.toString().match(/rule_(\d+)/);
                return match ? parseInt(match[1]) : 0;
            })
        );
        return maxId + 1;
    }, [rules]);

    // Build tree structure from flat array
    const buildTree = useCallback(() => {
        const ruleMap = {};
        rules.forEach((rule) => {
            ruleMap[rule.id] = {...rule, children: []};
        });

        rules.forEach((rule) => {
            if (rule.parentId && ruleMap[rule.parentId]) {
                ruleMap[rule.parentId].children.push(ruleMap[rule.id]);
            }
        });

        return rules
            .filter((r) => !r.parentId)
            .map((r) => ruleMap[r.id]);
    }, [rules]);

    // Add root node
    const addRootNode = useCallback(
        (type) => {
            const nextId = getNextId();
            const newRule = {
                id: `rule_${nextId}`,
                ruleType: type,
                ruleValue: "",
                ruleId: "",
                parentId: null,
                operator: "OR", // Root nodes are OR'd together
                level: 0,
                position: rules.filter(r => r.level === 0).length,
            };

            const updatedRules = [...rules, newRule];
            onChange?.(updatedRules);
        },
        [rules, getNextId, onChange]
    );

    // Add child node (AND relationship)
    const addChild = useCallback(
        (parentId, operator) => {
            const parent = rules.find((r) => r.id === parentId);
            if (!parent) return;

            // Get types already used in parent chain
            const usedTypes = [];
            let currentNode = parent;
            while (currentNode) {
                usedTypes.push(currentNode.ruleType);
                if (currentNode.parentId) {
                    currentNode = rules.find((r) => r.id === currentNode.parentId);
                } else {
                    currentNode = null;
                }
            }

            // Pick first available type that's not used
            const availableTypes = ["vendor", "collection", "category", "product"];
            const defaultType = availableTypes.find(t => !usedTypes.includes(t)) || "vendor";

            const childrenCount = rules.filter(r => r.parentId === parentId).length;
            const nextId = getNextId();

            const newRule = {
                id: `rule_${nextId}`,
                ruleType: defaultType,
                ruleValue: "",
                ruleId: "",
                parentId: parentId,
                operator: operator,
                level: parent.level + 1,
                position: childrenCount,
            };

            const updatedRules = [...rules, newRule];
            onChange?.(updatedRules);
        },
        [rules, getNextId, onChange]
    );

    // Add sibling node (OR relationship)
    const addSibling = useCallback(
        (parentId, operator) => {
            if (!parentId) {
                // Add root sibling - pick first available type
                const rootTypes = rules.filter(r => r.level === 0).map(r => r.ruleType);
                const availableTypes = ["vendor", "collection", "category", "product"];
                const defaultType = availableTypes.find(t => !rootTypes.includes(t)) || "vendor";
                addRootNode(defaultType);
                return;
            }

            const parent = rules.find((r) => r.id === parentId);
            if (!parent) return;

            // Get types already used in parent chain (same logic as addChild)
            const usedTypes = [];
            let currentNode = parent;
            while (currentNode) {
                usedTypes.push(currentNode.ruleType);
                if (currentNode.parentId) {
                    currentNode = rules.find((r) => r.id === currentNode.parentId);
                } else {
                    currentNode = null;
                }
            }

            // Pick first available type that's not used
            const availableTypes = ["vendor", "collection", "category", "product"];
            const defaultType = availableTypes.find(t => !usedTypes.includes(t)) || "vendor";

            const siblingsCount = rules.filter(
                (r) => r.parentId === parentId && r.level === parent.level + 1
            ).length;

            const nextId = getNextId();
            const newRule = {
                id: `rule_${nextId}`,
                ruleType: defaultType,
                ruleValue: "",
                ruleId: "",
                parentId: parentId,
                operator: operator,
                level: parent.level + 1,
                position: siblingsCount,
            };

            // When adding an OR sibling, update all existing siblings to OR as well
            // so they render horizontally together
            let updatedRules = [...rules, newRule];
            if (operator === "OR") {
                updatedRules = updatedRules.map((r) => {
                    // Update siblings with the same parent to OR
                    if (r.parentId === parentId && r.level === parent.level + 1) {
                        return {...r, operator: "OR"};
                    }
                    return r;
                });
            }

            onChange?.(updatedRules);
        },
        [rules, getNextId, onChange, addRootNode]
    );

    // Update rule
    const updateRule = useCallback(
        (ruleId, updatedRule) => {
            const updatedRules = rules.map((r) =>
                r.id === ruleId ? updatedRule : r
            );
            onChange?.(updatedRules);
        },
        [rules, onChange]
    );

    // Delete rule (and its children)
    const deleteRule = useCallback(
        (ruleId) => {
            const getChildrenIds = (parentId) => {
                const children = rules.filter((r) => r.parentId === parentId);
                let allIds = children.map((c) => c.id);
                children.forEach((child) => {
                    allIds = [...allIds, ...getChildrenIds(child.id)];
                });
                return allIds;
            };

            const idsToDelete = [ruleId, ...getChildrenIds(ruleId)];
            const updatedRules = rules.filter((r) => !idsToDelete.includes(r.id));
            onChange?.(updatedRules);
        },
        [rules, onChange]
    );

    // Get all parent rule types for a given node
    const getParentTypes = useCallback(
        (nodeId) => {
            const types = [];
            let currentNode = rules.find((r) => r.id === nodeId);

            while (currentNode && currentNode.parentId) {
                const parent = rules.find((r) => r.id === currentNode.parentId);
                if (parent) {
                    types.push(parent.ruleType);
                    currentNode = parent;
                } else {
                    break;
                }
            }

            return types;
        },
        [rules]
    );

    // Calculate the maximum width of a tree (for layout spacing)
    const calculateTreeWidth = useCallback(
        (node) => {
            const CARD_WIDTH = 250;
            const OR_GAP = 64; // gap="16" in Polaris = 64px (16 * 4px)

            const children = rules
                .filter((r) => r.parentId === node.id)
                .sort((a, b) => a.position - b.position);

            if (children.length === 0) {
                return CARD_WIDTH;
            }

            const orChildren = children.filter(c => c.operator === 'OR');
            const andChildren = children.filter(c => c.operator === 'AND');

            let maxWidth = CARD_WIDTH;

            // Calculate width of OR children (horizontal layout)
            // Layout: [Child1] GAP [Child2] GAP [Child3]
            // For N OR children: N child boxes + (N-1) gaps
            if (orChildren.length > 0) {
                const orChildrenWidths = orChildren.map(child => calculateTreeWidth(child));
                const totalChildWidth = orChildrenWidths.reduce((sum, w) => sum + w, 0);
                const numGaps = orChildren.length - 1;
                const totalOrWidth = totalChildWidth + (numGaps * OR_GAP);
                maxWidth = Math.max(maxWidth, totalOrWidth);
            }

            // Calculate width of AND children (vertical layout - they don't add width)
            if (andChildren.length > 0) {
                const andChildrenWidths = andChildren.map(child => calculateTreeWidth(child));
                const maxAndWidth = Math.max(...andChildrenWidths);
                maxWidth = Math.max(maxWidth, maxAndWidth);
            }

            return maxWidth;
        },
        [rules]
    );

    // Render tree recursively
    const renderNode = useCallback(
        (node, isRoot = false) => {
            const children = rules
                .filter((r) => r.parentId === node.id)
                .sort((a, b) => a.position - b.position);

            const hasANDChildren = children.some(c => c.operator === 'AND');
            const hasORChildren = children.some(c => c.operator === 'OR');

            // Get types that are already used in parent chain
            const usedParentTypes = getParentTypes(node.id);

            return (
                <div key={node.id} className="graph-builder-tree-node">
                    <VerticalStack gap="0">
                        <div className="graph-builder-node-wrapper">
                            <div className="graph-builder-node-container">
                                <RuleNode
                                    rule={node}
                                    onUpdate={updateRule}
                                    onDelete={deleteRule}
                                    onAddChild={addChild}
                                    onAddSibling={addSibling}
                                    vendors={vendors}
                                    collections={collections}
                                    categories={categories}
                                    products={products}
                                    level={node.level}
                                    isRoot={isRoot}
                                    usedParentTypes={usedParentTypes}
                                    hasChildren={children.length > 0}
                                />
                            </div>
                        </div>

                        {children.length > 0 && (
                            <>
                                <div className="graph-builder-connector-vertical">
                                    <div className="graph-builder-connector-line"/>
                                </div>

                                {hasANDChildren && (
                                    <div className="graph-builder-and-container">
                                        <VerticalStack gap="2">
                                            {children
                                                .filter(c => c.operator === 'AND')
                                                .map((child) => renderNode(child))}
                                        </VerticalStack>
                                    </div>
                                )}

                                {hasORChildren && (
                                    <div className="graph-builder-or-container">
                                        <HorizontalStack gap="16" align="start" wrap={false}>
                                            {children
                                                .filter(c => c.operator === 'OR')
                                                .map((child, index) => {
                                                    const orChildren = children.filter(c => c.operator === 'OR');
                                                    const isFirst = index === 0;
                                                    const isLast = index === orChildren.length - 1;

                                                    return (
                                                        <Fragment key={child.id}>
                                                            <div className="graph-builder-or-child">
                                                                <div className="graph-builder-or-line-vertical"/>

                                                                {!isFirst && (
                                                                    <div className="graph-builder-or-line-horizontal-left"/>
                                                                )}
                                                                {!isLast && (
                                                                    <div className="graph-builder-or-line-horizontal-right"/>
                                                                )}

                                                                {renderNode(child)}
                                                            </div>
                                                        </Fragment>
                                                    );
                                                })}
                                        </HorizontalStack>
                                    </div>
                                )}
                            </>
                        )}
                    </VerticalStack>
                </div>
            );
        },
        [
            rules,
            updateRule,
            deleteRule,
            addChild,
            addSibling,
            vendors,
            collections,
            categories,
            products,
            getParentTypes,
        ]
    );

    const rootNodes = buildTree();

    // Check if a product node already exists (only one product node allowed)
    const hasProductNode = rules.some(rule => rule.ruleType === "product");

    // Render graph content (reusable for both normal and fullscreen mode)
    const renderGraphContent = () => (
        <>
            <HorizontalStack gap="2" align="space-between">
                <HorizontalStack gap="2">
                    <div
                        onClick={() => addRootNode("vendor")}
                        className="graph-builder-add-button vendor"
                    >
                        <span>+</span> Add Vendor
                    </div>
                    <div
                        onClick={() => addRootNode("collection")}
                        className="graph-builder-add-button collection"
                    >
                        <span>+</span> Add Collection
                    </div>
                    <div
                        onClick={() => addRootNode("category")}
                        className="graph-builder-add-button category"
                    >
                        <span>+</span> Add Category
                    </div>
                    {!hasProductNode && (
                        <div
                            onClick={() => addRootNode("product")}
                            className="graph-builder-add-button product"
                        >
                            <span>+</span> Add Product
                        </div>
                    )}
                </HorizontalStack>
                <Button
                    onClick={() => setIsFullscreen(!isFullscreen)}
                    icon={isFullscreen ? MinimizeIcon : MaximizeIcon}
                    accessibilityLabel={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
                />
            </HorizontalStack>

            {/* Render tree */}
            {rootNodes.length > 0 ? (
                <div className={`graph-builder-tree-area ${isFullscreen ? 'fullscreen' : 'normal'}`}>
                    {rootNodes.length === 1 ? (
                        renderNode(rootNodes[0], true)
                    ) : (
                        <VerticalStack gap="4">
                            <Text as="p" variant="bodySm" tone="subdued">
                                Root level rules (OR) →
                            </Text>
                            <HorizontalStack gap="8" wrap={false}>
                                {rootNodes.map((node) => {
                                    const treeWidth = calculateTreeWidth(node);
                                    return (
                                        <div
                                            key={node.id}
                                            className="graph-builder-root-tree-container"
                                            style={{minWidth: `${treeWidth}px`}}
                                        >
                                            {renderNode(node, true)}
                                        </div>
                                    );
                                })}
                            </HorizontalStack>
                        </VerticalStack>
                    )}
                </div>
            ) : (
                <Box padding="400" background="bg-surface-secondary">
                    <Text as="p" tone="subdued" alignment="center">
                        No rules added yet. Click a button above to add your first rule.
                    </Text>
                </Box>
            )}
        </>
    );

    // Fullscreen overlay
    if (isFullscreen) {
        return (
            <div className="graph-builder-fullscreen-overlay">
                <div className="graph-builder-fullscreen-content">
                    <VerticalStack gap="5">
                        <VerticalStack gap="3">
                            <Text as="h2" variant="headingMd">
                                Product Targeting Rules
                            </Text>
                            <Text as="p" tone="subdued">
                                Add rules to target specific products. Horizontal connections = OR, Vertical connections
                                = AND
                            </Text>
                        </VerticalStack>

                        {renderGraphContent()}
                    </VerticalStack>
                </div>
            </div>
        );
    }

    return (
        <LegacyCard sectioned>
            <VerticalStack gap="5">
                <VerticalStack gap="3">
                    <Text as="h2" variant="headingMd">
                        Product Targeting Rules
                    </Text>
                    <Text as="p" tone="subdued">
                        Add rules to target specific products. Horizontal connections = OR, Vertical connections = AND
                    </Text>
                </VerticalStack>

                {renderGraphContent()}
            </VerticalStack>
        </LegacyCard>
    );
}
