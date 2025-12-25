import { useState, useCallback, useEffect } from "react";
import {
  Modal,
  TextField,
  Spinner,
  Text,
  Button,
  VerticalStack,
  Icon,
  ChoiceList,
} from "@shopify/polaris";
import { SearchIcon, FileIcon } from "@shopify/polaris-icons";

/**
 * FilePicker modal component for selecting existing files from Shopify admin
 */
export function FilePicker({ open, onClose, onSelect, fileType = "all" }) {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [search, setSearch] = useState("");
  const [searchValue, setSearchValue] = useState("");
  const [pageInfo, setPageInfo] = useState({ hasNextPage: false, endCursor: null });
  const [selectedFile, setSelectedFile] = useState(null);
  const [typeFilter, setTypeFilter] = useState(fileType);

  const fetchFiles = useCallback(async (cursor = null, append = false) => {
    if (cursor) {
      setLoadingMore(true);
    } else {
      setLoading(true);
    }

    try {
      const params = new URLSearchParams({
        limit: "24",
        type: typeFilter,
      });
      if (search) {
        params.append("search", search);
      }
      if (cursor) {
        params.append("cursor", cursor);
      }

      const response = await fetch(`/api/files/list?${params.toString()}`);
      const data = await response.json();

      if (data.success) {
        if (append) {
          setFiles((prev) => [...prev, ...data.files]);
        } else {
          setFiles(data.files);
        }
        setPageInfo(data.pageInfo);
      }
    } catch (error) {
      console.error("Error fetching files:", error);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [search, typeFilter]);

  useEffect(() => {
    if (open) {
      fetchFiles();
    }
  }, [open, fetchFiles]);

  useEffect(() => {
    if (open) {
      const debounce = setTimeout(() => {
        setSearch(searchValue);
      }, 300);
      return () => clearTimeout(debounce);
    }
  }, [searchValue, open]);

  const handleSelect = useCallback(() => {
    if (selectedFile) {
      onSelect(selectedFile);
      setSelectedFile(null);
      onClose();
    }
  }, [selectedFile, onSelect, onClose]);

  const handleClose = useCallback(() => {
    setSelectedFile(null);
    setSearch("");
    setSearchValue("");
    onClose();
  }, [onClose]);

  const handleLoadMore = useCallback(() => {
    if (pageInfo.hasNextPage && pageInfo.endCursor) {
      fetchFiles(pageInfo.endCursor, true);
    }
  }, [fetchFiles, pageInfo]);

  const handleTypeFilterChange = useCallback((value) => {
    setTypeFilter(value[0]);
  }, []);

  const isImage = (mimeType) => {
    return mimeType && mimeType.startsWith("image/");
  };

  const isPdf = (mimeType) => {
    return mimeType === "application/pdf";
  };

  const formatFileSize = (bytes) => {
    if (!bytes) return "";
    const kb = bytes / 1024;
    if (kb < 1024) return `${kb.toFixed(1)} KB`;
    const mb = kb / 1024;
    return `${mb.toFixed(1)} MB`;
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Select a file"
      primaryAction={{
        content: "Select",
        onAction: handleSelect,
        disabled: !selectedFile,
      }}
      secondaryActions={[
        {
          content: "Cancel",
          onAction: handleClose,
        },
      ]}
      large
    >
      <Modal.Section>
        <VerticalStack gap="4">
          <div style={{ display: "flex", gap: "16px", alignItems: "start" }}>
            <div style={{ flex: 1 }}>
              <TextField
                label=""
                labelHidden
                placeholder="Search files..."
                value={searchValue}
                onChange={setSearchValue}
                prefix={<Icon source={SearchIcon} />}
                autoComplete="off"
              />
            </div>
            <ChoiceList
              title=""
              titleHidden
              choices={[
                { label: "All files", value: "all" },
                { label: "Images", value: "image" },
                { label: "Documents", value: "file" },
              ]}
              selected={[typeFilter]}
              onChange={handleTypeFilterChange}
            />
          </div>

          {loading ? (
            <div style={{ display: "flex", justifyContent: "center", padding: "40px" }}>
              <Spinner size="large" />
            </div>
          ) : files.length === 0 ? (
            <div style={{ textAlign: "center", padding: "40px" }}>
              <Text tone="subdued">No files found</Text>
            </div>
          ) : (
            <>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
                  gap: "12px",
                  maxHeight: "400px",
                  overflowY: "auto",
                  padding: "4px",
                }}
              >
                {files.map((file) => (
                  <div
                    key={file.id}
                    onClick={() => setSelectedFile(file)}
                    style={{
                      border: selectedFile?.id === file.id ? "2px solid #008060" : "1px solid #e1e3e5",
                      borderRadius: "8px",
                      padding: "8px",
                      cursor: "pointer",
                      backgroundColor: selectedFile?.id === file.id ? "#f1f8f5" : "#fff",
                      transition: "all 0.15s ease",
                    }}
                  >
                    <div
                      style={{
                        width: "100%",
                        aspectRatio: "1",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        backgroundColor: "#f6f6f7",
                        borderRadius: "4px",
                        marginBottom: "8px",
                        overflow: "hidden",
                      }}
                    >
                      {isImage(file.mimeType) && file.url ? (
                        <img
                          src={file.url}
                          alt={file.alt || file.filename}
                          style={{
                            width: "100%",
                            height: "100%",
                            objectFit: "cover",
                          }}
                        />
                      ) : isPdf(file.mimeType) ? (
                        <div style={{ textAlign: "center", color: "#bf0711" }}>
                          <svg width="40" height="40" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm-1 2l5 5h-5V4zM8.5 13H10v4.5H8.5V13zm2.5 0h1.5v2h-1v1h1v1.5H11V13zm3.5 0H16v3a1 1 0 0 1-1 1h-1v-4z"/>
                          </svg>
                          <Text variant="bodySm">PDF</Text>
                        </div>
                      ) : (
                        <Icon source={FileIcon} tone="subdued" />
                      )}
                    </div>
                    <Text variant="bodySm" truncate>
                      {file.filename}
                    </Text>
                    {file.fileSize && (
                      <Text variant="bodySm" tone="subdued">
                        {formatFileSize(file.fileSize)}
                      </Text>
                    )}
                  </div>
                ))}
              </div>

              {pageInfo.hasNextPage && (
                <div style={{ textAlign: "center" }}>
                  <Button onClick={handleLoadMore} loading={loadingMore}>
                    Load more
                  </Button>
                </div>
              )}
            </>
          )}
        </VerticalStack>
      </Modal.Section>
    </Modal>
  );
}

export default FilePicker;
