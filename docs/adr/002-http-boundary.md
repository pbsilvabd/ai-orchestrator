# ADR-002 — Separate HTTP from replay safety

Date: 2026-11-02. Status: accepted for M1a.

Normalize status and Retry-After in a pure module separate from the policy.
Integer seconds and canonical IMF-fixdate are accepted; an absent header uses zero
(the policy still applies cooldown). Invalid values/overflow block fallback rather
than truncating a long delay and retrying too early. Obsolete date formats are
rejected at this stage; we do not claim complete HTTP parser compliance.

Reference: [RFC 9110, section 10.2.3](https://www.rfc-editor.org/rfc/rfc9110.html#section-10.2.3).

The normalizer never infers absence of effects from an HTTP code. The host must
supply safety metadata; omission blocks replay. Do not forward bodies, URLs or
arbitrary headers into state/logs. Transport tests use only 127.0.0.1 and fixtures
without tools, so they do not validate the OpenCode adapter.
