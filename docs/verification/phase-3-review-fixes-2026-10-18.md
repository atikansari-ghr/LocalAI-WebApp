# Phase 3 independent review fixes — 2026-10-18

Read-only review of a745177..eaee94f found two Important issues, no Critical/Minor issues. This record documents their reproduction and fixes; it does not qualify production release or publish runtime activation.

## Router child authentication boundary

The pinned vendor router strips API credentials from its children. Native reproduction confirmed unauthenticated model-list status401 on the parent and200 on a loaded child at a dynamic loopback port. The prior loopback-only configuration therefore failed the intended local-process isolation boundary.

Both worker units now use native `PrivateNetwork=true` plus permission-protected Unix sockets. A native namespace probe succeeded on this LXC; lack of support must block installation. Runtime directories are0750, sockets use group-restricted creation permissions, and the socket-access group is distinct from the model-read group. The gateway adapter uses Unix sockets by default and receives no service-management or namespace privileges.

RED→GREEN transport and unit-profile regressions ran on Debian. Native retesting verified:

- Router and each loaded child use a different network namespace from the LXC's main namespace; children share the router's isolated namespace.
- Child listeners do not appear among main-namespace TCP listeners.
- An unrelated `nobody` account receives EACCES when attempting the worker socket.
- A gateway-user probe with only the socket-access group can connect, but receives401 without the backend key.
- Real English/Arabic inference, normalized embeddings, streaming, cancellation, idle sleep/lazy reload and crash/restart still pass; actual fallback/circuit recovery also passes.
- Latest router aggregate current memory4,692,135,936bytes, observed historical peak4,719,271,936bytes, swap0. Gateway PID preserved. All private test workers stopped afterward.

The first Unix transport native repeat reproduced ECONNRESET after a completed stream. Diagnostics identified a stale pooled HTTP connection. Fresh local IPC connections resolved the repeat; no unsafe automatic POST retry was introduced. The child-enumeration check also needed to inspect children of every router thread rather than only its main thread.

## Circuit accounting

An internal deadline was previously treated like caller cancellation, preventing repeated hangs from opening the primary circuit. A fixture reproduced three expired requests followed by a fourth primary attempt, instead of fallback.

The adapter now distinguishes the caller's signal from its internal deadline. Three internal failures open the circuit for the next request. Failed partial streams similarly affect subsequent decisions. A current timed-out, partially delivered or caller-cancelled request is never retried. Explicit caller cancellation does not count as backend failure. Focused regressions cover deadline and partial-stream sequences and the next request's actual fallback selection.

## Gate status

Affected native harnesses pass with the fix. The clean-source full Debian suite and both CI jobs must pass for the final fix commit. Missing controlled activation, matching qualification evidence, deployment/recovery checks and later full-platform gates remain blockers. The enrolled account was not modified; no runtime activation file or production release was published.

Verified final fix commit d233ecc:92/92 tests passed on clean actual Debian with no skips; both required GitHub checks passed. Both updated native harnesses passed, including the protected socket-access group and child namespace assertions. This resolves the two Important core findings; it does not accept the later activation implementation.
