/**
 * Public submission relay — Cloudflare Pages Function (POST /api/submit).
 *
 * Takes a form submission from a visitor with no GitHub account and opens an
 * Issue on their behalf. A maintainer then labels it `approved`, and
 * .github/workflows/approve.yml publishes it.
 *
 * SECURITY — the whole reason this file exists:
 *   The GitHub token lives ONLY in this function's environment. It is never
 *   sent to the browser, never embedded in the built site, and never echoed in
 *   a response. The browser can create an issue but cannot do anything else,
 *   because it never holds a credential.
 *
 *   Give the token the narrowest scope that works: a fine-grained personal
 *   access token limited to this one repository, with Issues: Read and write
 *   and nothing else. It must NOT have contents:write — publishing is done by
 *   the Action, which uses its own scoped GITHUB_TOKEN.
 *
 * Environment (Cloudflare Pages → Settings → Environment variables):
 *   GITHUB_TOKEN     required   fine-grained PAT, Issues: read & write
 *   GITHUB_REPO      required   owner/name, e.g. "malathirenati/malathirenati.github.io"
 *   TURNSTILE_SECRET optional   enables bot checking when set
 *
 * Portable: Netlify and Vercel need only a different handler signature.
 */

const FIELDS = [
  { key: "track",    label: "Track",       max: 120,  required: true },
  { key: "group",    label: "Group",       max: 120 },
  { key: "event",    label: "Event",       max: 200,  required: true },
  { key: "start",    label: "Start",       max: 60,   required: true },
  { key: "end",      label: "End",         max: 60 },
  { key: "detail",   label: "Detail",      max: 1000 },
  { key: "location", label: "Location",    max: 120 },
  { key: "link",     label: "Source link", max: 500 },
];

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

export async function onRequestPost({ request, env }) {
  if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) {
    // Don't leak which piece is missing.
    console.error("submit: GITHUB_TOKEN or GITHUB_REPO not configured");
    return json(503, { error: "Submissions are not configured yet." });
  }

  let data;
  try {
    data = await request.json();
  } catch {
    return json(400, { error: "Expected JSON." });
  }

  // Honeypot: a real person never fills this in, because it is hidden.
  if (data.website) return json(200, { ok: true });

  if (env.TURNSTILE_SECRET) {
    const ok = await verifyTurnstile(env.TURNSTILE_SECRET, data.turnstileToken, request);
    if (!ok) return json(400, { error: "Could not verify you are human. Please try again." });
  }

  const values = {};
  for (const f of FIELDS) {
    const raw = data[f.key];
    const v = typeof raw === "string" ? raw.trim() : "";
    if (f.required && !v) return json(400, { error: `${f.label} is required.` });
    if (v.length > f.max) return json(400, { error: `${f.label} is too long (limit ${f.max}).` });
    values[f.key] = v;
  }

  if (values.link && !/^https?:\/\/[^\s]+$/i.test(values.link)) {
    return json(400, { error: "Source link must start with http:// or https://" });
  }

  const body = buildIssueBody(values, request);
  const title = `[Entry] ${values.event}`.slice(0, 240);

  const res = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/issues`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.GITHUB_TOKEN}`,
      accept: "application/vnd.github+json",
      "content-type": "application/json",
      "user-agent": "timeline-submission-relay",
    },
    body: JSON.stringify({ title, body, labels: ["submission", "from-website"] }),
  });

  if (!res.ok) {
    // Log server-side; return nothing that could expose the token or the repo.
    console.error("submit: GitHub returned", res.status, await res.text());
    return json(502, { error: "Could not file the submission. Please try again later." });
  }

  const issue = await res.json();
  return json(200, { ok: true, number: issue.number, url: issue.html_url });
}

/**
 * Emits exactly the "### Label\n\nvalue" shape GitHub's own Issue Forms produce,
 * so scripts/apply-submission.mjs parses website submissions and GitHub-native
 * ones through a single path.
 *
 * Values are fenced off from Markdown: a submission is untrusted text and must
 * not be able to forge a "### Track" heading and smuggle a different field past
 * review. Any line starting with # in a value gets a zero-width space.
 */
function buildIssueBody(values, request) {
  const safe = (v) => String(v).replace(/^(\s*)(#{1,6}\s)/gm, "$1​$2");

  const sections = FIELDS.map((f) => {
    const v = values[f.key];
    return `### ${f.label}\n\n${v ? safe(v) : "_No response_"}`;
  });

  const country = request.headers.get("cf-ipcountry") || "unknown";
  sections.push(
    "### Provenance\n\n" +
    `Submitted through the website form. Origin country: ${country}. ` +
    "Not yet verified — check the source before approving."
  );

  return sections.join("\n\n");
}

async function verifyTurnstile(secret, token, request) {
  if (!token) return false;
  const form = new FormData();
  form.append("secret", secret);
  form.append("response", token);
  const ip = request.headers.get("cf-connecting-ip");
  if (ip) form.append("remoteip", ip);

  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST", body: form,
    });
    const out = await res.json();
    return Boolean(out.success);
  } catch {
    return false;
  }
}

// Anything other than POST gets a clear answer rather than a stack trace.
export async function onRequest({ request }) {
  if (request.method === "POST") return; // handled above
  return new Response("Send a POST with JSON to submit a timeline entry.", {
    status: 405,
    headers: { allow: "POST" },
  });
}
