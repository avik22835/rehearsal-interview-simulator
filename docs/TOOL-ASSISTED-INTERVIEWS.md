# Tool-assisted interviews through the ChatGPT browser bridge

Recorded: 27 October 2026. This extends the agreed interview app idea; all six
modes remain required.

Architecture update, 28 October 2026: the selected future host is the Electron
desktop app with a managed ChatGPT view. The workflows and evidence rules below
carry over unchanged; extension-specific transport is a migration detail. See
[Desktop architecture](DESKTOP-ARCHITECTURE.md).

## Discovery and current status

The user reports that asking ChatGPT to use tools in the linked browser chat
worked, including testing Python code, and that the resulting answer returned
to the simulator through the gateway. Build on this useful capability for
interview practice and study.

This is a user-observed example, not a guarantee that every account/model has
Python execution, browsing, file analysis or other tools. The current gateway
relays assistant text. Structured tool calls, execution logs, downloadable
artifacts and app control over the remote runtime are not implemented features.

## Uses across the six modes

| Mode | Planned tool-assisted workflows | Evidence to retain |
| --- | --- | --- |
| Coding / DSA | Run submitted Python on permitted examples and edge cases; compare brute-force and optimized solutions on small inputs; find counterexamples; inspect exceptions and timings. | Code snapshot, inputs, expected/actual outputs, execution environment and provenance when available. |
| Project deep dive | Analyze selected code/docs; check an extracted algorithm experimentally; research a dependency or compare implementation choices when browsing is available. | Source versions, paths, returned citations and experiment inputs. A snippet test does not prove the local repository passes. |
| System design | Calculate traffic, storage, bandwidth and capacity; explore queue growth, cache hit rates and failure scenarios; produce tables/charts where supported. | Assumptions, units, calculation inputs/results and retrievable artifacts. A simulation is not a production load test. |
| Backend engineering | Exercise a small pure-Python example, check serialization, explore retry behavior, or analyze a selected log/trace excerpt. | Exact snippet/excerpt, conditions, output and limitations. Local services and integration tests use the isolated local runner. |
| AI / ML / LLM engineering | Calculate evaluation metrics, analyze a supplied dataset, compare retrieval/ranking results, inspect failure distributions, and test preprocessing/scoring functions. | Selected data/version, metric definitions, code, outputs and reproducibility information. No GPU training is implied. |
| Resume / behavioral | Analyze a selected resume/JD, map claims to role requirements, inspect supplied evidence, or calculate a metric from explicitly provided data. | Source-located claims and calculation inputs. Never invent experience, ownership or impact. |

Cross-mode uses include calculation checks, revision exercises based on mistakes,
practice datasets, researched explanations with source links, and supporting study
artifacts. These are planned uses, not claims that the bridge currently imports
generated files, renders charts or indexes web sources.

## Two complementary execution paths

1. **Local Docker runner:** the app controls code snapshots, inputs, resource
   limits, network policy and captured results. Keep this reproducible execution
   path in scope for coding interviews.
2. **ChatGPT browser tools:** optional remote analysis and experiments within
   the interview's existing chat. The remote environment does not automatically
   have local files, repositories, packages or services; share only selected inputs.

Use separate adapters. Tool-assisted browser replies are not an OpenAI-compatible
function-calling protocol or arbitrary app-side tool invocation. Never execute
model-produced commands in the API process. Remote Python does not replace Docker.

## Interview and study behavior

- Offer reasoning-first, tools-allowed and review-after-submission practice
  settings. Tools are optional; typed interviews remain usable without them.
- In assessment mode, collect candidate reasoning before checks. Keep hidden
  tests and solutions out of candidate-visible prompts. Share only tests allowed
  by the session's remote-context policy.
- In learning mode, support requests such as “test my Python solution,” “find
  an edge case,” “check this calculation,” and “explain this failure.” Follow up
  with a targeted exercise instead of automatically revealing the full solution.
- Keep the same ChatGPT conversation for the interview. Send the current task
  and selected code/data, not the whole history each time. Every new interview
  still starts a new chat, even if the previous one was unfinished.
- Separate tool results from the spoken question. TTS reads a concise useful
  explanation; code, tables, logs and references stay inspectable on screen.

## Evidence and reports

Persist tool-assistance events linked to the interview turn, candidate answer,
code/artifact snapshot, provider, conversation URL and timestamp. Record requested
task, selected inputs, returned answer, any captured output, status and limitations.
Never store browser cookies or authentication material.

Distinguish these evidence levels in the UI and reports:

- **Local execution captured:** the app ran the saved code and captured inputs,
  outputs and exit status under its isolated runner.
- **Remote execution output captured:** a future adapter captured identifiable
  tool output and provenance; it still describes a remote environment.
- **Assistant-reported result:** only the final text is available. Say
  “ChatGPT reports…” rather than claiming the app verified execution.
- **Reasoned analysis:** no execution evidence was returned. A prediction is
  not a successful test.

Continue exact candidate-quote checks for transcript assessment. Tool output is
a separate evidence type, not a candidate answer. Validate imported artifacts
and source citations before using them as stronger evidence. A claim that a tool
ran must not automatically become a verified test result or score. Preserve both
results when remote and local execution disagree.

## Capability handling, privacy and recovery

Check requested capabilities with a small explicit probe and record provider,
model, date and status: unavailable, unverified, user-observed or app-verified.
Working text streaming does not establish Python, browsing, file or vision tools.
If unavailable, offer local execution or reasoning-only review; never invent a run.

Reuse remote-sharing controls: preview selected code/documents/data, exclude
secrets, and explain that ChatGPT tool work leaves the laptop. Seek broader
sharing consent only when inputs exceed the session's existing authorization.
Generated artifacts need a validated import path before becoming app evidence.

Tool use can delay the final answer. Show a neutral waiting state until actual
tool events are observable; do not invent progress percentages or tool activity.
Stream returned text when available. Preserve cancellation/timeouts, and never
automatically repeat an ambiguously submitted task. Tool use must not create a
new interview chat or advance interview phases outside the app state machine.

## Delivery and acceptance

- **Phase 2:** local Python runner, shared execution-evidence record, optional
  ChatGPT-assisted code review/testing, and distinct local versus remote labels.
- **Phase 3:** concise spoken summaries and interruptible waiting/playback;
  logs and structured results stay visual.
- **Phase 4:** selected-source analysis, research citations and data experiments
  for project, backend and AI modes, gated by actual capabilities.
- **Phase 5:** design calculations and grounded resume/JD analysis.
- **Phase 6:** cross-provider checks, artifact export, provenance and recovery.
  No separate multi-agent framework is needed.

Acceptance: test a known-result code/input example, execution failure, unavailable
tool fallback, cancellation and timeout. Confirm correct interview association,
saved evidence after reload, a same-chat follow-up after tool use, and a fresh
chat for a new interview. Verify remote/local disagreement handling, permitted
context boundaries, and that assistant-reported execution is never silently
promoted to verified scoring evidence.
