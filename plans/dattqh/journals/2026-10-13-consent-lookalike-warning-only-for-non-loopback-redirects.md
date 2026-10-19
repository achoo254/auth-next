---
title: Consent lookalike warning only for non-loopback redirects
date: 2026-10-13
summary: Red lookalike box no longer fires for Localman MCP on loopback; deployed from a clean HEAD copy; committed as 37c4ff3
---

# Consent lookalike warning only for non-loopback redirects

## What happened
Connecting the official Localman MCP (`https://localman.hoandat.com/mcp`) to Claude Code showed a red "name looks like a hoandat.com product" box on every consent. Cause: `consent-handler.ts` set `imitatesFirstParty` from the client name alone (`imitatesFirstPartyName`), and Claude Code always names its DCR client "Claude Code (<server name>)", so every legitimate setup matched.

## Decision (Jev, jev-1.13.0)
- AgentKit skill: `ak-fix` 0.61 (ak-deploy 0.20, ak-agentkit 0.15).
- Fix: show the red box only when the name looks first-party AND the redirect host is not loopback, 0.90 (keep as is 0.09, drop both boxes 0.01). Reason: a loopback redirect with PKCE delivers the code only to the machine that clicks Allow, so a remote lookalike cannot phish there. The yellow external-app notice stays for every DCR client.
- Deploy now: 0.59 (weak yes; user had authorized a redeploy if needed). Deploy source: clean copy of HEAD + patch, 0.99.

## Changes
`isLoopbackHostname` exported from `src/oidc/registration-policy.ts`; `redirectUriOf` in `src/interactions/consent-handler.ts` returns the URL so both host and loopback are derived from it; warning reworded in en/vi/zh-CN; vitest cases for loopback (no red box) and https website redirect (red box). Committed by peer session hoandat-auth-43 as 37c4ff3.

## What went wrong / lessons
- The shared working tree held another session's unfinished /account redesign, which `infra/deploy.sh` would have shipped (it builds from its own directory). Deployed from `git archive HEAD` + patch in a scratch dir after checking prod dist matched HEAD (built 15:51:11 right after e3bb4a4). Snapshot failures in the shared tree came from the other work; on the clean copy only the 3 intended `consent.lookalikeWarning` snapshots changed.
- Missed `e2e/signup-consent.spec.ts`, which still asserted the red box for a loopback MCP client. The peer session caught it at commit time and changed it to `toHaveCount(0)`. Next time grep e2e/ (not just src/__tests__) for a changed data-id before calling a UI-rule change verified.
- The context hook blocks any command containing `node_modules`, so the clean copy used `pnpm install --prefer-offline` instead of a symlink.

## Verification
Clean copy: biome 0, tsc 0, check:tokens clean, vitest 494/494. Prod: healthz ok, restarts 27 to 28, 0 unstable, error log empty, bundle has the new text. Peer commit gates: e2e 10/10. Prod now runs 0f867ff (includes 37c4ff3), pushed.

## Next steps
None required. User can re-run `/mcp` to see the lighter consent page.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
