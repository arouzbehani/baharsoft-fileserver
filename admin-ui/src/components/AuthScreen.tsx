import { useState, type FormEvent } from "react"
import { Database, KeyRound, ShieldCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

interface Props {
  setupRequired: boolean
  bootstrapRequired: boolean
  busy: boolean
  error: string
  onSubmit: (username: string, password: string, bootstrapToken: string) => Promise<void>
}

export function AuthScreen({ setupRequired, bootstrapRequired, busy, error, onSubmit }: Props) {
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [confirmation, setConfirmation] = useState("")
  const [bootstrapToken, setBootstrapToken] = useState("")
  const mismatch = setupRequired && confirmation && password !== confirmation

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!mismatch) void onSubmit(username, password, bootstrapToken)
  }

  return <main className="auth-shell">
    <section className="auth-story">
      <div className="brand-mark"><Database className="size-5" /><span>Baharsoft</span></div>
      <div className="max-w-xl">
        <p className="eyebrow">File Server Console</p>
        <h1>One quiet place to control every project’s files.</h1>
        <p className="auth-copy">Manage trusted applications, tenant boundaries, and access grants without coupling file storage to your users’ identity provider.</p>
        <div className="auth-points">
          <div><ShieldCheck /><span>Private by design</span></div>
          <div><KeyRound /><span>Secrets shown once</span></div>
        </div>
      </div>
      <p className="auth-foot">Independent authentication. Stable document IDs. Generic metadata.</p>
    </section>
    <section className="auth-form-panel">
      <form className="auth-card" onSubmit={submit}>
        <div className="mb-8">
          <span className="step-pill">{setupRequired ? "First-run setup" : "Administrator access"}</span>
          <h2>{setupRequired ? "Create your administrator" : "Welcome back"}</h2>
          <p>{setupRequired ? "This account controls file-server configuration." : "Sign in to manage clients and tenants."}</p>
        </div>
        <label>Username<Input autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="administrator" required minLength={3} /></label>
        <label>Password<Input type="password" autoComplete={setupRequired ? "new-password" : "current-password"} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 12 characters" required minLength={12} /></label>
        {setupRequired && <label>Confirm password<Input type="password" autoComplete="new-password" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} required minLength={12} /></label>}
        {setupRequired && bootstrapRequired && <label>Bootstrap token<Input type="password" autoComplete="off" value={bootstrapToken} onChange={(e) => setBootstrapToken(e.target.value)} placeholder="From the deployment environment" required /></label>}
        {(error || mismatch) && <p className="form-error" role="alert">{mismatch ? "The passwords do not match." : error}</p>}
        <Button className="mt-2 w-full" disabled={busy || Boolean(mismatch)}>{busy ? "Please wait…" : setupRequired ? "Create administrator" : "Sign in"}</Button>
      </form>
    </section>
  </main>
}
