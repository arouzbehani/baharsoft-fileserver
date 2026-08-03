import { useEffect, useState, type FormEvent } from "react"
import { FileUp } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"

interface Props {
  open: boolean
  tenant: string
  busy: boolean
  error: string
  onOpenChange: (open: boolean) => void
  onUpload: (input: {
    file: File
    folder: string
    visibility: "private" | "public"
    tags: Array<{ key: string; value: string }>
  }) => Promise<void>
}

function parseTags(value: string) {
  return value
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const separator = item.indexOf(":")
      if (separator <= 0 || separator === item.length - 1) {
        throw new Error(`Tag "${item}" must use key:value`)
      }
      return {
        key: item.slice(0, separator).trim(),
        value: item.slice(separator + 1).trim(),
      }
    })
}

export function UploadFileDialog({ open, tenant, busy, error, onOpenChange, onUpload }: Props) {
  const [file, setFile] = useState<File | null>(null)
  const [folder, setFolder] = useState("documents")
  const [visibility, setVisibility] = useState<"private" | "public">("private")
  const [tagText, setTagText] = useState("")
  const [localError, setLocalError] = useState("")

  useEffect(() => {
    if (!open) return
    setFile(null)
    setFolder("documents")
    setVisibility("private")
    setTagText("")
    setLocalError("")
  }, [open])

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!file) return setLocalError("Choose a file to upload.")
    try {
      setLocalError("")
      void onUpload({ file, folder, visibility, tags: parseTags(tagText) })
    } catch (caught) {
      setLocalError(caught instanceof Error ? caught.message : "Tags are invalid.")
    }
  }

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent>
      <div className="secret-icon"><FileUp /></div>
      <DialogTitle className="mt-4 text-xl font-bold">Upload to {tenant}</DialogTitle>
      <DialogDescription className="mt-1 text-sm text-slate-500">Add a generic stored document. Project relationships remain in the consuming application.</DialogDescription>
      <form className="mt-6 space-y-5" onSubmit={submit}>
        <label>File<Input type="file" onChange={(event) => setFile(event.target.files?.[0] || null)} required /></label>
        <label>Folder<Input value={folder} onChange={(event) => setFolder(event.target.value)} placeholder="documents" required /></label>
        <label>Visibility
          <select className="field-select" value={visibility} onChange={(event) => setVisibility(event.target.value as "private" | "public")}>
            <option value="private">Private</option>
            <option value="public">Public</option>
          </select>
        </label>
        <label>Tags <span className="label-note">one key:value per line</span>
          <textarea className="field-textarea" value={tagText} onChange={(event) => setTagText(event.target.value)} placeholder={"documentType:passport\norigin:original\nlanguage:fa"} rows={4} />
        </label>
        {(localError || error) && <p className="form-error" role="alert">{localError || error}</p>}
        <div className="flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={busy || !tenant}>{busy ? "Uploading…" : "Upload file"}</Button>
        </div>
      </form>
    </DialogContent>
  </Dialog>
}
