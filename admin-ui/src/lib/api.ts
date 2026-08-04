export type Permission = "upload" | "read" | "delete" | "restore" | "purge"

export interface ServiceClient {
  clientId: string
  displayName: string
  active: boolean
  tokenVersion: number
  tenants: string[]
  permissions: Permission[]
  createdAt: string
  updatedAt: string
}

export interface Session {
  admin: { id: number; username: string }
  csrfToken: string
  expiresAt: string
}

export interface ClientInput {
  clientId: string
  displayName: string
  tenants: string[]
  permissions: Permission[]
}

export type FileStatus = "active" | "deleted" | "purged"

export interface AdminFile {
  id: number
  documentId: string
  tenant: string
  folder: string
  originalName: string
  storedName: string
  visibility: "public" | "private"
  mimeType: string
  size: number
  uploadedAt: string
  uploadedBy: string | null
  checksumSha256: string
  status: FileStatus
  deletedAt: string | null
  purgedAt: string | null
  tags: Array<{ key: string; value: string }>
}

export interface FileFilters {
  tenant: string
  folder?: string
  visibility?: string
  status?: string
  search?: string
  tags?: string[]
  cursor?: string
  limit?: number
}

let csrfToken = ""
const adminPathSegment = window.location.pathname.split("/").filter(Boolean)[0]
const adminApiBase = adminPathSegment ? `/${adminPathSegment}/api` : "/api"

export class ApiError extends Error {
  constructor(public code: string, message: string, public status: number) {
    super(message)
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method || "GET").toUpperCase()
  const headers = new Headers(init.headers)
  if (init.body && !(init.body instanceof FormData)) {
    headers.set("content-type", "application/json")
  }
  if (!["GET", "HEAD"].includes(method) && csrfToken) {
    headers.set("x-admin-csrf", csrfToken)
  }
  const response = await fetch(`${adminApiBase}${path}`, {
    ...init,
    headers,
    credentials: "same-origin",
  })
  if (response.status === 204) return undefined as T
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new ApiError(body.error || "REQUEST_FAILED", body.message || "The request failed", response.status)
  }
  return body as T
}

function rememberSession(session: Session) {
  csrfToken = session.csrfToken
  return session
}

export const api = {
  setupStatus: () => request<{ setupRequired: boolean; bootstrapRequired: boolean }>("/setup/status"),
  setup: (username: string, password: string, bootstrapToken: string) => request<Session>("/setup", { method: "POST", body: JSON.stringify({ username, password, bootstrapToken }) }).then(rememberSession),
  login: (username: string, password: string) => request<Session>("/login", { method: "POST", body: JSON.stringify({ username, password }) }).then(rememberSession),
  session: () => request<Session>("/session").then(rememberSession),
  logout: async () => { await request<void>("/logout", { method: "POST" }); csrfToken = "" },
  clients: () => request<{ clients: ServiceClient[] }>("/clients"),
  createClient: (input: ClientInput) => request<{ client: ServiceClient; clientSecret: string }>("/clients", { method: "POST", body: JSON.stringify(input) }),
  updateClient: (input: ClientInput) => request<ServiceClient>(`/clients/${encodeURIComponent(input.clientId)}`, { method: "PUT", body: JSON.stringify(input) }),
  rotateClient: (clientId: string) => request<{ client: ServiceClient; clientSecret: string }>(`/clients/${encodeURIComponent(clientId)}/rotate-secret`, { method: "POST" }),
  setClientActive: (clientId: string, active: boolean) => request<ServiceClient>(`/clients/${encodeURIComponent(clientId)}/${active ? "enable" : "disable"}`, { method: "POST" }),
  tenants: () => request<{ tenants: string[] }>("/tenants"),
  files: (filters: FileFilters) => {
    const query = new URLSearchParams()
    if (filters.folder) query.set("folder", filters.folder)
    if (filters.visibility && filters.visibility !== "all") query.set("visibility", filters.visibility)
    if (filters.status) query.set("status", filters.status)
    if (filters.search) query.set("search", filters.search)
    if (filters.cursor) query.set("cursor", filters.cursor)
    if (filters.limit) query.set("limit", String(filters.limit))
    filters.tags?.forEach((tag) => query.append("tag", tag))
    return request<{ items: AdminFile[]; page: { limit: number; hasMore: boolean; nextCursor: string | null } }>(`/files/${encodeURIComponent(filters.tenant)}?${query}`)
  },
  uploadFile: (tenant: string, folder: string, visibility: string, file: File, tags: Array<{ key: string; value: string }>) => {
    const form = new FormData()
    form.append("file", file)
    form.append("metadata", JSON.stringify({ tags }))
    return request<{ file: AdminFile }>(`/files/${encodeURIComponent(tenant)}/upload/${folder.split("/").map(encodeURIComponent).join("/")}?visibility=${encodeURIComponent(visibility)}`, { method: "POST", body: form })
  },
  fileContentUrl: (file: Pick<AdminFile, "tenant" | "documentId">) => `${adminApiBase}/files/${encodeURIComponent(file.tenant)}/${encodeURIComponent(file.documentId)}/content`,
  deleteFile: (file: Pick<AdminFile, "tenant" | "documentId">) => request(`/files/${encodeURIComponent(file.tenant)}/${encodeURIComponent(file.documentId)}`, { method: "DELETE" }),
  restoreFile: (file: Pick<AdminFile, "tenant" | "documentId">) => request(`/files/${encodeURIComponent(file.tenant)}/${encodeURIComponent(file.documentId)}/restore`, { method: "POST" }),
  purgeFile: (file: Pick<AdminFile, "tenant" | "documentId">) => request(`/files/${encodeURIComponent(file.tenant)}/${encodeURIComponent(file.documentId)}/purge`, { method: "POST" }),
}
