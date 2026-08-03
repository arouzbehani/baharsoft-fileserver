import { useEffect, useState } from "react"
import { AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import type { AdminFile } from "@/lib/api"

export function PurgeFileDialog({ file, busy, onClose, onConfirm }: {
  file: AdminFile | null
  busy: boolean
  onClose: () => void
  onConfirm: (file: AdminFile) => Promise<void>
}) {
  const [confirmation, setConfirmation] = useState("")
  useEffect(() => setConfirmation(""), [file])
  if (!file) return null
  return <Dialog open={Boolean(file)} onOpenChange={(open) => !open && onClose()}>
    <DialogContent className="max-w-md">
      <div className="danger-icon"><AlertTriangle /></div>
      <DialogTitle className="mt-4 text-xl font-bold">Permanently purge file?</DialogTitle>
      <DialogDescription className="mt-2 text-sm leading-6 text-slate-500">The stored binary will be removed and cannot be restored. Type the filename to confirm.</DialogDescription>
      <div className="purge-target"><span>Filename</span><strong>{file.originalName}</strong><code>{file.documentId}</code></div>
      <label className="mt-5">Type filename<Input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" /></label>
      <div className="mt-5 flex justify-end gap-3">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="danger" disabled={busy || confirmation !== file.originalName} onClick={() => void onConfirm(file)}>{busy ? "Purging…" : "Permanently purge"}</Button>
      </div>
    </DialogContent>
  </Dialog>
}
