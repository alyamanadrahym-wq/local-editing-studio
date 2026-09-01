---
name: Securing browser-to-loopback services
description: Security rule for a hosted browser UI that controls a processor bound to the user's localhost.
---

A browser-facing service bound to loopback must require an unpredictable, locally generated pairing credential on every non-health request. Treat CORS as an additional browser control, not authorization.

**Why:** A broad hosted-origin allowlist lets unrelated pages from the same hosting platform reach an unauthenticated localhost service. Loopback binding prevents remote socket access but does not stop the user's browser from acting as a deputy.

**How to apply:** Use constant-time credential validation, keep the service on loopback, disable unauthenticated discovery routes, never log the credential in the web client, and require it for uploads, job control, results, downloads, and deletion.