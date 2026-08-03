function requireTenantAccess(permission) {
  return (req, res, next) => {
    const auth = req.auth;
    const tenant = req.params[0];

    if (!auth) {
      return res.status(401).json({ error: "UNAUTHORIZED" });
    }

    const tenants = Array.isArray(auth.tenants) ? auth.tenants : [];
    const permissions = Array.isArray(auth.permissions) ? auth.permissions : [];

    if (!tenant || !tenants.includes(tenant)) {
      return res.status(403).json({ error: "TENANT_ACCESS_DENIED" });
    }

    if (!permissions.includes(permission)) {
      return res.status(403).json({ error: "INSUFFICIENT_PERMISSION" });
    }

    return next();
  };
}

module.exports = requireTenantAccess;