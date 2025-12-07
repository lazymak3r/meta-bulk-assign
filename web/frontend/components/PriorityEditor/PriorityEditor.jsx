import { useState, useCallback } from "react";
import { TextField, Button, HorizontalStack } from "@shopify/polaris";
import "./PriorityEditor.css";

/**
 * Inline priority editor component
 * Allows quick editing of configuration priority
 */
export function PriorityEditor({ priority, onSave, configId }) {
  const [value, setValue] = useState(String(priority));
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = useCallback(async () => {
    const newPriority = parseInt(value, 10);
    if (isNaN(newPriority)) {
      setValue(String(priority));
      setIsEditing(false);
      return;
    }

    setIsSaving(true);
    try {
      await onSave(configId, newPriority);
      setIsEditing(false);
    } catch (error) {
      console.error("Failed to update priority:", error);
      setValue(String(priority));
    } finally {
      setIsSaving(false);
    }
  }, [value, priority, configId, onSave]);

  const handleCancel = useCallback(() => {
    console.log('test');
    setValue(String(priority));
    setIsEditing(false);
  }, [priority]);

  const handleChange = useCallback((newValue) => {
    setValue(newValue);
  }, []);

  const handleClick = useCallback(() => {
    setIsEditing(true);
  }, []);

  const handleKeyPress = useCallback(
    (event) => {
      if (event.key === "Enter") {
        handleSave();
      } else if (event.key === "Escape") {
        handleCancel();
      }
    },
    [handleSave, handleCancel]
  );

  if (!isEditing) {
    return (
      <Button
        variant="plain"
        onClick={handleClick}
        disabled={isSaving}
      >
        {priority || "0"}
      </Button>
    );
  }

  return (
    <HorizontalStack gap="2" blockAlign="center">
      <div style={{ width: "80px" }} className="priority-editor-input">
        <TextField
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyPress}
          type="number"
          autoComplete="off"
          autoFocus
          label=""
        />
      </div>
      <Button
        size="slim"
        onClick={handleSave}
        loading={isSaving}
      >
        Save
      </Button>
      <Button
        size="slim"
        onClick={handleCancel}
        disabled={isSaving}
      >
        Cancel
      </Button>
    </HorizontalStack>
  );
}
