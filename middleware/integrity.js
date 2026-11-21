const licensedDomain = process.env.LICENSE_DOMAIN?.trim().toLowerCase();

async function verifyIntegrity(req) {
  if (!licensedDomain) return true;
  return req.hostname?.toLowerCase() === licensedDomain;
}

async function protectSource(req, res, next) {
  if (!await verifyIntegrity(req)) {
    return res.status(403).send("This hostname is not configured for this site.");
  }
  next();
}

module.exports = { verifyIntegrity, protectSource };
