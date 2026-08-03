import { useCallback, useEffect, useMemo, useState } from "react"
import { Activity, Database, Files, KeyRound, LayoutDashboard, LogOut, MoreHorizontal, Plus, RefreshCw, Server, ShieldCheck, Users } from "lucide-react"
import { AuthScreen } from "@/components/AuthScreen"
import { ClientDialog, SecretDialog } from "@/components/ClientDialog"
import { FilesView } from "@/components/FilesView"
import { Button } from "@/components/ui/button"
import { api, ApiError, type ClientInput, type ServiceClient, type Session } from "@/lib/api"

type Page = "overview" | "clients" | "files"

function message(error: unknown) {
  return error instanceof ApiError ? error.message : "Something went wrong. Please try again."
}

export default function App() {
  const [loading, setLoading] = useState(true)
  const [setupRequired, setSetupRequired] = useState(false)
  const [bootstrapRequired, setBootstrapRequired] = useState(false)
  const [session, setSession] = useState<Session | null>(null)
  const [clients, setClients] = useState<ServiceClient[]>([])
  const [tenants, setTenants] = useState<string[]>([])
  const [page, setPage] = useState<Page>("overview")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<ServiceClient | null>(null)
  const [secret, setSecret] = useState({ value: "", clientId: "" })
  const [menu, setMenu] = useState<string | null>(null)

  const loadDashboard = useCallback(async () => {
    const [clientResult, tenantResult] = await Promise.all([api.clients(), api.tenants()])
    setClients(clientResult.clients)
    setTenants(tenantResult.tenants)
  }, [])

  useEffect(() => {
    void (async () => {
      try {
        const current = await api.session()
        setSession(current)
        await loadDashboard()
      } catch {
        const status = await api.setupStatus()
        setSetupRequired(status.setupRequired)
        setBootstrapRequired(status.bootstrapRequired)
      } finally { setLoading(false) }
    })()
  }, [loadDashboard])

  async function authenticate(username: string, password: string, bootstrapToken: string) {
    setBusy(true); setError("")
    try {
      const current = setupRequired ? await api.setup(username, password, bootstrapToken) : await api.login(username, password)
      setSession(current); setSetupRequired(false); await loadDashboard()
    } catch (err) { setError(message(err)) } finally { setBusy(false) }
  }

  async function saveClient(input: ClientInput) {
    setBusy(true); setError("")
    try {
      if (editing) await api.updateClient(input)
      else {
        const result = await api.createClient(input)
        setSecret({ value: result.clientSecret, clientId: result.client.clientId })
      }
      setDialogOpen(false); setEditing(null); await loadDashboard()
    } catch (err) { setError(message(err)) } finally { setBusy(false) }
  }

  async function rotate(client: ServiceClient) {
    setMenu(null)
    try {
      const result = await api.rotateClient(client.clientId)
      setSecret({ value: result.clientSecret, clientId: client.clientId })
      await loadDashboard()
    } catch (err) { setError(message(err)) }
  }

  async function toggleClient(client: ServiceClient) {
    setMenu(null)
    try { await api.setClientActive(client.clientId, !client.active); await loadDashboard() }
    catch (err) { setError(message(err)) }
  }

  const tenantCount = useMemo(() => tenants.length, [tenants])
  if (loading) return <div className="loading-screen"><div className="loading-mark"><Database /></div><p>Opening file server...</p></div>
  if (!session) return <AuthScreen setupRequired={setupRequired} bootstrapRequired={bootstrapRequired} busy={busy} error={error} onSubmit={authenticate} />

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand-mark"><Database className="size-5" /><span>Baharsoft</span></div>
      <nav>
        <button className={page === "overview" ? "active" : ""} onClick={() => setPage("overview")}><LayoutDashboard />Overview</button>
        <button className={page === "files" ? "active" : ""} onClick={() => setPage("files")}><Files />Files</button>
        <button className={page === "clients" ? "active" : ""} onClick={() => setPage("clients")}><Users />Service clients</button>
        <button className="disabled" disabled><Activity />Activity <span>Soon</span></button>
      </nav>
      <div className="sidebar-foot"><ShieldCheck /><div><strong>Protected console</strong><span>Local administrator</span></div></div>
    </aside>
    <main className="workspace">
      <header className="topbar">
        <div><p className="eyebrow">Administration</p><h1>{page === "files" ? "Stored files" : page === "clients" ? "Service clients" : "File server"}</h1></div>
        <div className="admin-menu"><span className="avatar">{session.admin.username.slice(0, 2).toUpperCase()}</span><div><strong>{session.admin.username}</strong><span>Administrator</span></div><Button variant="ghost" size="icon" aria-label="Sign out" onClick={() => void api.logout().then(() => setSession(null))}><LogOut /></Button></div>
      </header>
      <section className="content">
        {page !== "files" && <div className="status-strip"><span><i />Service operational</span><span>SQLite connected</span><span>Private administration</span></div>}
        {page === "overview" && <>
          <div className="metrics">
            <article><span>Service clients</span><strong>{clients.length}</strong><Users /></article>
            <article><span>Active clients</span><strong>{clients.filter((client) => client.active).length}</strong><Activity /></article>
            <article><span>Configured tenants</span><strong>{tenantCount}</strong><Database /></article>
          </div>
          <div className="overview-actions">
            <button onClick={() => setPage("files")}><span><Files /></span><div><strong>Control stored files</strong><p>Browse tenants, inspect metadata, upload, download, and manage lifecycle.</p></div></button>
            <button onClick={() => setPage("clients")}><span><Server /></span><div><strong>Manage applications</strong><p>Configure trusted backends, tenant grants, permissions, and secrets.</p></div></button>
          </div>
        </>}
        {page === "clients" && <section className="client-section page-section">
          <div className="section-heading"><div><p className="eyebrow">Trusted backends</p><h2>Connected applications</h2><p>Backends trusted to access tenant files.</p></div><Button onClick={() => { setEditing(null); setError(""); setDialogOpen(true) }}><Plus />Add client</Button></div>
          {error && !dialogOpen && <p className="banner-error">{error}</p>}
          {clients.length === 0 ? <div className="empty-state"><div><KeyRound /></div><h3>No applications connected</h3><p>Create a service client to connect your first project backend.</p><Button onClick={() => setDialogOpen(true)}><Plus />Connect an application</Button></div> :
          <div className="client-list">
            {clients.map((client) => <article className="client-row" key={client.clientId}>
              <div className="client-identity"><span className="client-icon">{client.displayName.slice(0, 2).toUpperCase()}</span><div><h3>{client.displayName}</h3><code>{client.clientId}</code></div></div>
              <div className="tenant-list">{client.tenants.map((tenant) => <span key={tenant}>{tenant}</span>)}</div>
              <div className="grant-list">{client.permissions.slice(0, 3).map((permission) => <span key={permission}>{permission}</span>)}{client.permissions.length > 3 && <span>+{client.permissions.length - 3}</span>}</div>
              <span className={client.active ? "status active" : "status"}><i />{client.active ? "Active" : "Disabled"}</span>
              <div className="row-menu"><Button variant="ghost" size="icon" aria-label={`Actions for ${client.displayName}`} onClick={() => setMenu(menu === client.clientId ? null : client.clientId)}><MoreHorizontal /></Button>
                {menu === client.clientId && <div className="menu-popover"><button onClick={() => { setEditing(client); setError(""); setDialogOpen(true); setMenu(null) }}>Edit grants</button><button onClick={() => void rotate(client)}><RefreshCw />Rotate secret</button><button className={client.active ? "danger" : ""} onClick={() => void toggleClient(client)}>{client.active ? "Disable client" : "Enable client"}</button></div>}
              </div>
            </article>)}
          </div>}
        </section>}
        {page === "files" && <FilesView tenants={tenants} onChanged={loadDashboard} />}
      </section>
    </main>
    <ClientDialog open={dialogOpen} client={editing} busy={busy} error={error} onOpenChange={(open) => { setDialogOpen(open); if (!open) setEditing(null) }} onSubmit={saveClient} />
    <SecretDialog secret={secret.value} clientId={secret.clientId} onClose={() => setSecret({ value: "", clientId: "" })} />
  </div>
}
