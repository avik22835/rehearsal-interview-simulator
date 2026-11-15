# Python question drivers

1 November 2026: workspaces now support optional model-generated Python adapters,
in addition to the existing application-owned JSON-function/stdin harness.

The model's problem JSON may contain `driver: null` for ordinary functions, or
`driver: {code, description, input_format, output_format}`. The adapter defines
`run_case(candidate, args, kwargs)`, converts public JSON fixtures into the problem's
real objects, invokes candidate code, and returns a JSON-compatible observation.
Optional `CANDIDATE_GLOBALS` definitions are injected before candidate import so
node annotations and provided judge APIs work without changing the original API.

This supports node-based lists/trees/graphs/random pointers, in-place outputs,
stateful class operation sequences, fixture-backed callbacks and property-based
judging for multiple valid results. They are per-question adapters, not a fixed
question bank. They can still be wrong: generated driver correctness is not proven
by Python syntax validation or by passing public examples.

Only AST syntax/interface validation happens on the host. All adapter execution
takes place inside the same no-network, read-only, bounded Docker sandbox as the
candidate, with per-case timeouts. Expected values remain outside the container
payload; comparison remains server-owned. Adapter code must do input conversion,
invocation, serialization or output validation, never replace the candidate's
algorithm or hardcode expected answers. This is an explicit model contract, not a
static proof that generated Python obeys it.

Open **Driver** beside Description and Source & notes to inspect adapter.py plus
the full driver.py/invoke.py wrapper. A recorded-run selector shows the exact
source snapshot used by that run. Driver files, provenance and a SHA-256 fingerprint
are retained in run results; submitted problem snapshots and exports retain the
adapter too. Assessment prompts distinguish adapter faults from candidate faults.
Driver changes require a new prepared problem version, preserving earlier runs.
Existing simple workspaces keep using the generic driver; older complex questions
must be prepared again to obtain a custom adapter.

This is a Python 3.12 standard-library runner, not universal LeetCode compatibility.
Other languages, SQL dialects/Pandas environments, platform-specific concurrency,
unavailable external judge semantics and official private tests are not supplied.
Preparation should ask for clarification rather than silently simplify such a
question. A fixture-backed mock API is only a local simulation of that API.

Verification covers real Docker execution for lists, binary trees, graph cloning,
random pointers, in-place outputs, a stateful class, a judge callback, and multiple
valid output orders. Additional tests cover malformed adapters, host non-execution,
read-only enforcement, adapter timeouts, preparation and export. Browser verification
also checks the full source viewer and the driver captured by a linked-list run.

78 API tests passed. A live desktop ChatGPT preparation generated a linked-list
adapter, which ran four public examples successfully with an independently supplied
reverse-list implementation. Local evidence: data/driver-live-verification.json;
verification interview 16fa877f-e83f-45fa-94e8-8e3cee8f570c. This checks that one
real generated adapter works, not that all future generated judges are correct.
