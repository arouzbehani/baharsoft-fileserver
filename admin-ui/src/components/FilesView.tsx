import { useCallback, useEffect, useState, type FormEvent } from "react"
import { Copy, File, FileImage, FileText, Filter, FolderOpen, MoreHorizontal, Plus, RefreshCw, RotateCcw, Search, Trash2 } from "lucide-react"
import { FileDetailsDialog } from "@/components/FileDetailsDialog"
import { PurgeFileDialog } from "@/components/PurgeFileDialog"
import { UploadFileDialog } from "@/components/UploadFileDialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { api, ApiError, type AdminFile } from "@/lib/api"

function errorMessage(error: unknown) {
  return error instanceof ApiError ? error.message : "The file operation failed."
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`
  const units = ["KB", "MB", "GB"]
  let size = value / 1024
  let index = 0
  while (size >= 1024 && index < units.length - 1) { size /= 1024; index += 1 }
  return `${size.toFixed(size >= 10 ? 1 : 2)} ${units[index]}`
}

function iconFor(file: AdminFile) {
  if (file.mimeType.startsWith("image/")) return <FileImage />
  if (file.mimeType === "application/pdf" || file.mimeType.startsWith("text/")) return <FileText />
  return <File />
}

interface Props { tenants: string[]; onChanged: () => Promise<void> }

export function FilesView({ tenants, onChanged }: Props) {
  const [tenant, setTenant] = useState(tenants[0] || "")
  const [files, setFiles] = useState<AdminFile[]>([])
  const [search, setSearch] = useState("")
  const [folder, setFolder] = useState("")
  const [status, setStatus] = useState("active")
  const [visibility, setVisibility] = useState("all")
  const [tagText, setTagText] = useState("")
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [uploadOpen, setUploadOpen] = useState(false)
  const [selected, setSelected] = useState<AdminFile | null>(null)
  const [purging, setPurging] = useState<AdminFile | null>(null)
  const [menu, setMenu] = useState<string | null>(null)

  useEffect(() => {
    if (!tenant && tenants.length) setTenant(tenants[0])
  }, [tenant, tenants])

  const load = useCallback(async (append = false) => {
    if (!tenant) { setFiles([]); return }
    setBusy(true); setError("")
    try {
      const tags = tagText.split(/\r?\n|,/).map((tag) => tag.trim()).filter(Boolean)
      const result = await api.files({ tenant, search, folder, status, visibility, tags, cursor: append ? nextCursor || undefined : undefined })
      setFiles((current) => append ? [...current, ...result.items] : result.items)
      setNextCursor(result.page.nextCursor)
    } catch (caught) { setError(errorMessage(caught)) }
    finally { setBusy(false) }
  }, [tenant, search, folder, status, visibility, tagText, nextCursor])

  useEffect(() => { void load(false) }, [tenant, status, visibility])

  function applyFilters(event: FormEvent) {
    event.preventDefault()
    void load(false)
  }

  async function refresh() {
    await Promise.all([load(false), onChanged()])
  }

  async function upload(input: { file: globalThis.File; folder: string; visibility: "private" | "public"; tags: Array<{ key: string; value: string }> }) {
    setBusy(true); setError("")
    try {
      await api.uploadFile(tenant, input.folder, input.visibility, input.file, input.tags)
      setUploadOpen(false); await refresh()
    } catch (caught) { setError(errorMessage(caught)) }
    finally { setBusy(false) }
  }

  async function remove(file: AdminFile) {
    if (!window.confirm(`Move ${file.originalName} to deleted files?`)) return
    setBusy(true)
    try { await api.deleteFile(file); setSelected(null); await refresh() }
    catch (caught) { setError(errorMessage(caught)) }
    finally { setBusy(false) }
  }

  async function restore(file: AdminFile) {
    setBusy(true)
    try { await api.restoreFile(file); setSelected(null); await refresh() }
    catch (caught) { setError(errorMessage(caught)) }
    finally { setBusy(false) }
  }

  async function purge(file: AdminFile) {
    setBusy(true)
    try { await api.purgeFile(file); setPurging(null); setSelected(null); await refresh() }
    catch (caught) { setError(errorMessage(caught)) }
    finally { setBusy(false) }
  }

  return <section className="files-workspace">
    <div className="section-heading files-heading"><div><p className="eyebrow">Storage operations</p><h2>Files</h2><p>Inspect and control documents without adding project-specific relationships.</p></div><Button disabled={!tenant} onClick={() => setUploadOpen(true)}><Plus />Upload file</Button></div>
    {!tenants.length ? <div className="empty-state"><div><FolderOpen /></div><h3>No tenants configured</h3><p>Create a service client with a tenant before uploading files.</p></div> : <>
      <form className="file-toolbar" onSubmit={applyFilters}>
        <label>Tenant<select className="field-select" value={tenant} onChange={(event) => setTenant(event.target.value)}>{tenants.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label className="search-field">Search<div><Search /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Filename or document ID" /></div></label>
        <label>Folder<Input value={folder} onChange={(event) => setFolder(event.target.value)} placeholder="All folders" /></label>
        <label>Status<select className="field-select" value={status} onChange={(event) => setStatus(event.target.value)}><option value="active">Active</option><option value="deleted">Deleted</option><option value="purged">Purged</option><option value="all">All</option></select></label>
        <label>Visibility<select className="field-select" value={visibility} onChange={(event) => setVisibility(event.target.value)}><option value="all">All</option><option value="private">Private</option><option value="public">Public</option></select></label>
        <label className="tag-filter">Tags<Input value={tagText} onChange={(event) => setTagText(event.target.value)} placeholder="documentType:passport" /></label>
        <Button variant="secondary"><Filter />Apply</Button>
        <Button type="button" variant="ghost" size="icon" onClick={() => void refresh()} aria-label="Refresh files"><RefreshCw /></Button>
      </form>
      {error && <p className="banner-error">{error}</p>}
      <div className="file-table-wrap">
        <table className="file-table">
          <thead><tr><th>File</th><th>Folder</th><th>Tags</th><th>Size</th><th>Uploaded</th><th>Status</th><th /></tr></thead>
          <tbody>{files.map((file) => <tr key={file.documentId} onClick={() => setSelected(file)}>
            <td><div className="file-name"><span>{iconFor(file)}</span><div><strong>{file.originalName}</strong><code>{file.documentId}</code></div></div></td>
            <td><code>{file.folder}</code></td>
            <td><div className="table-tags">{file.tags.slice(0, 2).map((tag) => <span key={`${tag.key}:${tag.value}`}>{tag.key}:{tag.value}</span>)}{file.tags.length > 2 && <span>+{file.tags.length - 2}</span>}</div></td>
            <td>{formatBytes(file.size)}</td>
            <td>{new Date(file.uploadedAt).toLocaleDateString()}</td>
            <td><span className={`file-status ${file.status}`}>{file.status}</span></td>
            <td><div className="row-menu"><Button variant="ghost" size="icon" onClick={(event) => { event.stopPropagation(); setMenu(menu === file.documentId ? null : file.documentId) }} aria-label={`Actions for ${file.originalName}`}><MoreHorizontal /></Button>{menu === file.documentId && <div className="menu-popover file-actions">
              <button onClick={(event) => { event.stopPropagation(); void navigator.clipboard.writeText(file.documentId); setMenu(null) }}><Copy />Copy document ID</button>
              {file.status === "active" && <button className="danger" onClick={(event) => { event.stopPropagation(); setMenu(null); void remove(file) }}><Trash2 />Delete</button>}
              {file.status === "deleted" && <><button onClick={(event) => { event.stopPropagation(); setMenu(null); void restore(file) }}><RotateCcw />Restore</button><button className="danger" onClick={(event) => { event.stopPropagation(); setMenu(null); setPurging(file) }}><Trash2 />Purge</button></>}
            </div>}</div></td>
          </tr>)}</tbody>
        </table>
        {!busy && !files.length && <div className="table-empty">No files match these filters.</div>}
      </div>
      {nextCursor && <div className="load-more"><Button variant="secondary" disabled={busy} onClick={() => void load(true)}>{busy ? "Loading…" : "Load more"}</Button></div>}
    </>}
    <UploadFileDialog open={uploadOpen} tenant={tenant} busy={busy} error={error} onOpenChange={setUploadOpen} onUpload={upload} />
    <FileDetailsDialog file={selected} busy={busy} onClose={() => setSelected(null)} onDelete={remove} onRestore={restore} onPurge={(file) => { setSelected(null); setPurging(file) }} />
    <PurgeFileDialog file={purging} busy={busy} onClose={() => setPurging(null)} onConfirm={purge} />
  </section>
}
