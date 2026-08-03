import { useEffect, useState, type FormEvent } from "react"
import { Check, Copy, KeyRound } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import type { ClientInput, Permission, ServiceClient } from "@/lib/api"

const permissions: Permission[] = ["upload", "read", "delete", "restore", "purge"]

interface Props {
  open: boolean
  client?: ServiceClient | null
  busy: boolean
  error: string
  onOpenChange: (open: boolean) => void
  onSubmit: (input: ClientInput) => Promise<void>
}

export function ClientDialog({ open, client, busy, error, onOpenChange, onSubmit }: Props) {
  const [clientId, setClientId] = useState("")
  const [displayName, setDisplayName] = useState("")
  const [tenants, setTenants] = useState("")
  const [selected, setSelected] = useState<Permission[]>(["upload", "read"])

  useEffect(() => {
    setClientId(client?.clientId || "")
    setDisplayName(client?.displayName || "")
    setTenants(client?.tenants.join(", ") || "")
    setSelected(client?.permissions || ["upload", "read"])
  }, [client, open])

  function toggle(permission: Permission) {
    setSelected((current) => current.includes(permission) ? current.filter((item) => item !== permission) : [...current, permission])
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    void onSubmit({
      clientId,
      displayName,
      tenants: tenants.split(",").map((item) => item.trim()).filter(Boolean),
      permissions: selected,
    })
  }

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent>
      <DialogTitle className="text-xl font-bold text-slate-950">{client ? "Edit service client" : "Connect an application"}</DialogTitle>
      <DialogDescription className="mt-1 text-sm text-slate-500">Grant a trusted backend access to specific tenants and operations.</DialogDescription>
      <form className="mt-6 space-y-5" onSubmit={submit}>
        <label>Client ID<Input value={clientId} onChange={(e) => setClientId(e.target.value)} disabled={Boolean(client)} placeholder="baharsoft-demo-api" required /></label>
        <label>Display name<Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Baharsoft Demo API" required /></label>
        <label>Tenants <span className="label-note">comma separated</span><Input value={tenants} onChange={(e) => setTenants(e.target.value)} placeholder="baharsoft-demo" required /></label>
        <fieldset>
          <legend>Permissions</legend>
          <div className="permission-grid">
            {permissions.map((permission) => <button type="button" key={permission} className={selected.includes(permission) ? "permission active" : "permission"} onClick={() => toggle(permission)}>
              <span className="check-box">{selected.includes(permission) && <Check />}</span>{permission}
            </button>)}
          </div>
        </fieldset>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={busy || selected.length === 0}>{busy ? "Saving…" : client ? "Save changes" : "Create client"}</Button>
        </div>
      </form>
    </DialogContent>
  </Dialog>
}

export function SecretDialog({ secret, clientId, onClose }: { secret: string; clientId: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    await navigator.clipboard.writeText(secret)
    setCopied(true)
  }
  return <Dialog open={Boolean(secret)} onOpenChange={(open) => !open && onClose()}>
    <DialogContent>
      <div className="secret-icon"><KeyRound /></div>
      <DialogTitle className="mt-4 text-xl font-bold">Save this client secret</DialogTitle>
      <DialogDescription className="mt-2 text-sm leading-6 text-slate-500">This is the only time the secret for <strong>{clientId}</strong> will be displayed. Store it in the application’s secret manager.</DialogDescription>
      <div className="secret-value"><code>{secret}</code><Button type="button" size="icon" variant="ghost" onClick={copy} aria-label="Copy secret">{copied ? <Check /> : <Copy />}</Button></div>
      <Button className="mt-5 w-full" onClick={onClose}>I have saved the secret</Button>
    </DialogContent>
  </Dialog>
}
