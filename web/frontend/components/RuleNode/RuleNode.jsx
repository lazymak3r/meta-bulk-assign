import { useCallback, useState } from "react";
import {
  LegacyCard,
  Select,
  Button,
  ButtonGroup,
  Badge,
  HorizontalStack,
  VerticalStack,
  Icon,
  Text,
  Autocomplete,
  Tag,
} from "@shopify/polaris";
import { PlusCircleIcon, DeleteIcon } from "@shopify/polaris-icons";
import "./RuleNode.css";

/**
 * Individual rule node component
 * Displays a rule with type selector, value input, and AND/OR add buttons
 */
export function RuleNode({
  rule,
  onUpdate,
  onDelete,
  onAddChild,
  onAddSibling,
  vendors = [],
  collections = [],
  categories = [],
  products = [],
  level = 0,
  isRoot = false,
  usedParentTypes = [],
  hasChildren = false,
}) {
  // Use rule prop directly (controlled component)
  const selectedType = rule.ruleType || "vendor";
  const selectedValue = rule.ruleValue || "";

  // For products, parse as array (stored as JSON string)
  const selectedProducts = (() => {
    if (selectedType !== "product" || !selectedValue) return [];
    try {
      return typeof selectedValue === "string" ? JSON.parse(selectedValue) : selectedValue;
    } catch {
      return [];
    }
  })();

  // Autocomplete state for products
  const [inputValue, setInputValue] = useState("");

  // Rule type options - filter out types already used in parent chain
  // Product is excluded - products can only be added via root "Add Product" button
  const allTypeOptions = [
    { label: "Vendor", value: "vendor" },
    { label: "Collection", value: "collection" },
    { label: "Category", value: "category" },
  ];

  // Filter out types that are already used in parent chain
  const typeOptions = allTypeOptions.filter(
    (option) => !usedParentTypes.includes(option.value)
  );

  // Get value options based on selected type
  const getValueOptions = useCallback(() => {
    switch (selectedType) {
      case "vendor":
        return vendors.map((v) => ({ label: v, value: v }));
      case "collection":
        return collections.map((c) => ({ label: c.title, value: c.title, id: c.id }));
      case "category":
        return categories.map((c) => ({ label: c, value: c }));
      case "product":
        return products.map((p) => ({ label: p.title, value: p.id }));
      default:
        return [];
    }
  }, [selectedType, vendors, collections, categories, products]);

  const valueOptions = getValueOptions();

  // Filter options for autocomplete based on input
  const filteredOptions = selectedType === "product"
    ? valueOptions.filter((option) =>
        option.label.toLowerCase().includes(inputValue.toLowerCase())
      )
    : valueOptions;

  // Handle type change
  const handleTypeChange = useCallback(
    (value) => {
      onUpdate(rule.id, {
        ...rule,
        ruleType: value,
        ruleValue: "",
        ruleId: "",
      });
    },
    [rule, onUpdate]
  );

  // Handle value change
  const handleValueChange = useCallback(
    (value) => {
      const option = valueOptions.find((o) => o.value === value);
      const id = option?.id || "";

      onUpdate(rule.id, {
        ...rule,
        ruleValue: value,
        ruleId: id,
      });
    },
    [rule, onUpdate, valueOptions]
  );

  // Handle product multiselect change
  const handleProductsChange = useCallback(
    (selected) => {
      const selectedProductData = selected.map(productId => {
        const product = products.find(p => p.id === productId);
        return { id: productId, title: product?.title || "" };
      });

      onUpdate(rule.id, {
        ...rule,
        ruleValue: JSON.stringify(selectedProductData),
        ruleId: JSON.stringify(selected),
      });
    },
    [rule, onUpdate, products]
  );

  // Handle removing a product tag
  const handleRemoveProduct = useCallback(
    (productId) => {
      const updatedProducts = selectedProducts.filter(p => p.id !== productId);
      onUpdate(rule.id, {
        ...rule,
        ruleValue: JSON.stringify(updatedProducts),
        ruleId: JSON.stringify(updatedProducts.map(p => p.id)),
      });
    },
    [rule, onUpdate, selectedProducts]
  );

  const allUsedTypes = [...usedParentTypes, selectedType];
  const allTypeValues = ["vendor", "collection", "category"];
  const hasAvailableTypes = !hasChildren && selectedType !== "product" && allUsedTypes.length < allTypeValues.length;

  return (
    <div className="rule-node-container">
      <LegacyCard>
        <div className={`rule-node-card-content ${selectedType}`}>
          <VerticalStack gap="1">
            <HorizontalStack align="space-between">
              <div className={`rule-node-badge ${selectedType}`}>
                {selectedType.charAt(0).toUpperCase() + selectedType.slice(1)}
              </div>
              <Button
                icon={DeleteIcon}
                destructive
                onClick={() => onDelete(rule.id)}
                size="slim"
              />
            </HorizontalStack>

            {selectedType !== "product" && (
              <div className="rule-node-select">
                <Select
                  label="Type"
                  labelHidden
                  options={typeOptions}
                  value={selectedType}
                  onChange={handleTypeChange}
                  disabled={hasChildren}
                />
              </div>
            )}

            {selectedType === "product" ? (
              valueOptions.length > 0 ? (
                <>
                  <div className="rule-node-autocomplete">
                    <Autocomplete
                      allowMultiple
                      options={filteredOptions}
                      selected={selectedProducts.map(p => p.id)}
                      onSelect={handleProductsChange}
                      textField={
                        <Autocomplete.TextField
                          label="Products"
                          labelHidden
                          value={inputValue}
                          onChange={setInputValue}
                          placeholder="Search products..."
                          autoComplete="off"
                        />
                      }
                    />
                  </div>
                  {selectedProducts.length > 0 && (
                    <HorizontalStack gap="1" wrap>
                      {selectedProducts.map((product) => (
                        <Tag key={product.id} onRemove={() => handleRemoveProduct(product.id)}>
                          {product.title}
                        </Tag>
                      ))}
                    </HorizontalStack>
                  )}
                </>
              ) : (
                <Text as="p" tone="subdued" variant="bodySm">
                  No products available.
                </Text>
              )
            ) : (
              valueOptions.length > 0 ? (
                <div className="rule-node-select">
                  <Select
                    label="Value"
                    labelHidden
                    options={valueOptions}
                    value={selectedValue}
                    onChange={handleValueChange}
                    placeholder={`Select ${selectedType}`}
                  />
                </div>
              ) : (
                <Text as="p" tone="subdued" variant="bodySm">
                  No {selectedType}s available.
                </Text>
              )
            )}
          </VerticalStack>
        </div>
      </LegacyCard>

      {hasAvailableTypes && (
        <div
          onClick={() => onAddChild(rule.id, "AND")}
          className={`rule-node-action-circle and ${selectedType}`}
        >
          AND
        </div>
      )}

      {!isRoot && selectedType !== "product" && (
        <div
          onClick={() => onAddSibling(rule.parentId, "OR")}
          className={`rule-node-action-circle or ${selectedType}`}
        >
          OR
        </div>
      )}
    </div>
  );
}
