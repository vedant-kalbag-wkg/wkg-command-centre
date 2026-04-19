"use client";

import { useState, useRef, useTransition } from "react";
import { FileText, Download, Trash2, Upload, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress, ProgressTrack, ProgressIndicator } from "@/components/ui/progress";
import { getContractUploadUrl, saveContractDocument, removeContractDocument } from "@/app/(app)/locations/actions";
import { format } from "date-fns";

type ContractDocument = {
  fileName: string;
  s3Key: string;
  uploadedAt: string;
};

interface ContractDocumentsProps {
  locationId: string;
  initialDocuments: ContractDocument[] | null | undefined;
  disabled?: boolean;
  onDocumentsChange?: (docs: ContractDocument[]) => void;
}

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

export function ContractDocuments({
  locationId,
  initialDocuments,
  disabled = false,
  onDocumentsChange,
}: ContractDocumentsProps) {
  const [documents, setDocuments] = useState<ContractDocument[]>(
    initialDocuments ?? []
  );
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [confirmRemoveKey, setConfirmRemoveKey] = useState<string | null>(null);
  const [isRemoving, startRemoveTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Reset file input so same file can be re-selected
    e.target.value = "";

    // Client-side size check
    if (file.size > MAX_FILE_SIZE) {
      setUploadError("File too large. Maximum size is 10 MB.");
      return;
    }

    setUploadError(null);
    setUploadProgress(0);

    try {
      // Get presigned URL
      const result = await getContractUploadUrl(file.name, file.type || "application/octet-stream");
      if ("error" in result) {
        setUploadError(result.error);
        setUploadProgress(null);
        return;
      }

      const { presignedUrl, s3Key } = result;

      // Upload to S3 using XMLHttpRequest for progress tracking
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            setUploadProgress(Math.round((event.loaded / event.total) * 100));
          }
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve();
          } else {
            reject(new Error(`Upload failed with status ${xhr.status}`));
          }
        };
        xhr.onerror = () => reject(new Error("Upload failed"));
        xhr.open("PUT", presignedUrl);
        xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
        xhr.send(file);
      });

      // Save document record
      const saveResult = await saveContractDocument(locationId, s3Key, file.name);
      if ("error" in saveResult) {
        setUploadError(saveResult.error ?? "Failed to save document");
        setUploadProgress(null);
        return;
      }

      // Update local state
      const newDoc: ContractDocument = {
        fileName: file.name,
        s3Key,
        uploadedAt: new Date().toISOString(),
      };
      const updated = [...documents, newDoc];
      setDocuments(updated);
      onDocumentsChange?.(updated);
      setUploadProgress(null);
    } catch {
      setUploadError("Upload failed. Check your connection and try again.");
      setUploadProgress(null);
    }
  };

  const handleRemove = (s3Key: string) => {
    startRemoveTransition(async () => {
      const result = await removeContractDocument(locationId, s3Key);
      if ("error" in result) {
        setUploadError(result.error ?? "Failed to remove document");
        return;
      }
      const updated = documents.filter((d) => d.s3Key !== s3Key);
      setDocuments(updated);
      onDocumentsChange?.(updated);
      setConfirmRemoveKey(null);
    });
  };

  return (
    <div className="space-y-3">
      {/* File list */}
      {documents.length > 0 ? (
        <div className="space-y-2">
          {documents.map((doc) => (
            <div
              key={doc.s3Key}
              className="flex items-center gap-3 rounded-lg border border-border px-3 py-2"
            >
              <FileText className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
              <div className="flex-1 min-w-0">
                <p className="truncate text-sm text-foreground">{doc.fileName}</p>
                <p className="text-[11px] text-muted-foreground">
                  Uploaded {format(new Date(doc.uploadedAt), "dd MMM yyyy")}
                </p>
              </div>

              {confirmRemoveKey === doc.s3Key ? (
                // Inline confirmation
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-[12px] text-muted-foreground">
                    Remove {doc.fileName}?
                  </span>
                  <button
                    onClick={() => handleRemove(doc.s3Key)}
                    disabled={isRemoving}
                    className="text-[12px] font-medium text-destructive hover:underline"
                  >
                    {isRemoving ? "Removing…" : "Remove"}
                  </button>
                  <button
                    onClick={() => setConfirmRemoveKey(null)}
                    className="text-[12px] text-muted-foreground hover:underline"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-1">
                  <a
                    href={`https://${process.env.NEXT_PUBLIC_AWS_S3_BUCKET}.s3.amazonaws.com/${doc.s3Key}`}
                    download={doc.fileName}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={`Download ${doc.fileName}`}
                    className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Download className="h-3.5 w-3.5" />
                  </a>
                  {!disabled && (
                    <button
                      type="button"
                      onClick={() => setConfirmRemoveKey(doc.s3Key)}
                      title={`Remove ${doc.fileName}`}
                      className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-destructive transition-colors"
                      aria-label={`Remove ${doc.fileName}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No documents uploaded yet</p>
      )}

      {/* Upload progress */}
      {uploadProgress !== null && (
        <div className="space-y-1">
          <Progress value={uploadProgress}>
            <ProgressTrack>
              <ProgressIndicator className="bg-primary" />
            </ProgressTrack>
          </Progress>
          <p className="text-[12px] text-muted-foreground">
            Uploading… {uploadProgress}%
          </p>
        </div>
      )}

      {/* Upload error */}
      {uploadError && (
        <p className="text-[12px] text-destructive">{uploadError}</p>
      )}

      {/* Upload button */}
      {!disabled && uploadProgress === null && (
        <>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.doc,.docx,.xls,.xlsx"
            className="hidden"
            onChange={handleFileChange}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleUploadClick}
          >
            <Upload className="mr-1.5 h-3.5 w-3.5" />
            Upload document
          </Button>
        </>
      )}

      {uploadProgress !== null && (
        <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          Uploading…
        </div>
      )}
    </div>
  );
}
