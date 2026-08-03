import { useState } from "react"
import { Check, Copy, Download, Eye, FileText, RotateCcw, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { api, type AdminFile } from "@/lib/api"

function bytes(value: number) {
  if (value < 1024) return `${value} B`
  const units = ["KB", "MB", "GB", "TB"]
  let size = value / 1024
  let index = 0
  while (size >= 1024 && index < units.length - 1) { size /= 1024; index += 1 }
  return `${size.toFixed(size >= 10 ? 1 : 2)} ${units[index]}`
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="file-detail"><span>{label}</span><div>{children}</div></div>
}

interface Props {
  file: AdminFile | null
  busy: boolean
  onClose: () => void
  onDelete: (file: AdminFile) => Promise<void>
  onRestore: (file: AdminFile) => Promise<void>
  onPurge: (file: AdminFile) => void
}

export function FileDetailsDialog({ file, busy, onClose, onDelete, onRestore, onPurge }: Props) {
  const [copied, setCopied] = useState<"id" | "url" | null>(null)
  if (!file) return null
  const previewable = file.status === "active" && (file.mimeType === "application/pdf" || file.mimeType.startsWith("image/"))
  const contentUrl = api.fileContentUrl(file)

  async function copy(value: string, target: "id" | "url") {
    await navigator.clipboard.writeText(value)
    setCopied(target)
  }

  return <Dialog open={Boolean(file)} onOpenChange={(open) => !open && onClose()}>
    <DialogContent className="max-w-3xl">
      <DialogTitle className="pr-8 text-xl font-bold">{file.originalName}</DialogTitle>
      <DialogDescription className="mt-1 text-sm text-slate-500">Stored in {file.tenant} / {file.folder}</DialogDescription>
      {previewable && <div className="file-preview">
        {file.mimeType === "application/pdf" ? <iframe src={contentUrl} title={`Preview ${file.originalName}`} /> : <img src={contentUrl} alt={`Preview of ${file.originalName}`} />}
      </div>}
      <div className="file-details-grid">
        <Detail label="Document ID"><div className="copy-line"><code>{file.documentId}</code><Button variant="ghost" size="icon" onClick={() => void copy(file.documentId, "id")} aria-label="Copy document ID">{copied === "id" ? <Check /> : <Copy />}</Button></div></Detail>
        <Detail label="Stable API URL"><div className="copy-line"><code>{`/files/document/${file.tenant}/${file.documentId}`}</code><Button variant="ghost" size="icon" onClick={() => void copy(`/files/document/${file.tenant}/${file.documentId}`, "url")} aria-label="Copy stable API URL">{copied === "url" ? <Check /> : <Copy />}</Button></div></Detail>
        <Detail label="Status"><span className={`file-status ${file.status}`}>{file.status}</span></Detail>
        <Detail label="Visibility">{file.visibility}</Detail>
        <Detail label="Type">{file.mimeType || "Unknown"}</Detail>
        <Detail label="Size">{bytes(file.size)}</Detail>
        <Detail label="Uploaded">{new Date(file.uploadedAt).toLocaleString()}</Detail>
        <Detail label="Uploaded by">{file.uploadedBy || "Unknown"}</Detail>
        <Detail label="Checksum"><code className="checksum">{file.checksumSha256}</code></Detail>
      </div>
      <div className="detail-tags">{file.tags.length ? file.tags.map((tag) => <span key={`${tag.key}:${tag.value}`}><b>{tag.key}</b>{tag.value}</span>) : <em>No tags</em>}</div>
      <div className="detail-actions">
        {file.status === "active" && <>
          <Button asChild variant="secondary"><a href={contentUrl} target="_blank" rel="noreferrer" download={previewable ? undefined : file.originalName}>{previewable ? <Eye /> : <Download />}{previewable ? "Open" : "Download"}</a></Button>
          <Button variant="danger" disabled={busy} onClick={() => void onDelete(file)}><Trash2 />Delete</Button>
        </>}
        {file.status === "deleted" && <>
          <Button disabled={busy} onClick={() => void onRestore(file)}><RotateCcw />Restore</Button>
          <Button variant="danger" disabled={busy} onClick={() => onPurge(file)}><Trash2 />Permanently purge</Button>
        </>}
      </div>
    </DialogContent>
  </Dialog>
}
