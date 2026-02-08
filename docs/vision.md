# Forge — Spec-Driven Development for Agentic Coding

## Philosophy

> "Converge on what to do, then do it. Everything else is ceremony."

A deterministic, spec-driven development system powered by AI agents. Forge is both an **opinionated stack** (technologies and architectural patterns chosen to maximize agent reliability) and an **orchestrator** (a three-phase workflow that drives agents from plan to merged code with quality gates at every step). Each step has explicit gates, nothing advances until checks pass, and the architecture is designed so that agents get instant, automated feedback at every layer.

Forge has two complementary halves:

- **The Stack** — an opinionated set of technologies, architectural patterns, and static analysis rules chosen specifically to maximize agent reliability and minimize human oversight.
- **The Orchestrator** — a three-phase workflow (Plan → Execute → Verify) with quality gates, fresh-context execution, and full test coverage that drives agents through the entire development lifecycle.

Together they form a closed loop: the stack provides the signals, the orchestrator enforces the discipline.

## Evidence & Claim Policy

This document is a v1 normative specification. Claims must be auditable:

- Numeric benchmark or performance claims MUST include a citation token in Markdown reference style (for example, `[example-benchmark]`).
- Acquisition or company-status claims MUST include both a concrete date and a citation token.
- If a claim has no citation, it MUST be phrased as qualitative guidance (not as a quantified fact).
- Placeholder citations are acceptable during drafting, but they MUST be replaced before final publication.

### References

- [Claude Flow](https://github.com/ruvnet/claude-flow) (original inspiration)
- [Get Shit Done (GSD)](https://github.com/glittercowboy/get-shit-done)

[ts-bench]: TODO: Add source URL + accessed date for TypeScript benchmark claim.
[bun-acq-2025]: TODO: Add source URL + accessed date for Bun acquisition/status claim (December 2025).
[bun-install-speed]: TODO: Add source URL + accessed date for Bun package installation speed comparison.
[bun-runtime-speed]: TODO: Add source URL + accessed date for Bun script/cold-start speed comparison.

---

## High-Level Flow

```
PLAN      →  Iterative loop until user approves
EXECUTE   →  Per task, fresh context, TDD cycle
VERIFY    →  Cross-cutting validation, UAT, PR
```

---

## Part I: The Stack

The architecture and technology choices are not incidental — they are load-bearing. Every decision is made to give AI agents **structural, deterministic feedback** at edit-time, reducing reliance on runtime checks or human review.

### Design Principle: Structural Constraints over Semantic Rules

The architecture is designed so that every important constraint can be expressed as a **file-location rule** or an **import-path rule**. ESLint with typescript-eslint can enforce structural conventions at edit-time through the LSP, giving agents the same instant feedback that more complex semantic analysis would provide.

The trade-off is explicit: we give up the ability to write rules like "every class implementing interface X must have method Y" (which would require Roslyn-level semantic analysis). In exchange, we design the architecture so that equivalent guarantees come from the file system itself: "every module must have a `routes.ts` that default-exports a `RouteRegistrar`."

### Architecture: Modulith

One deployable application, but internally **strictly modular**: clear boundaries, limited dependencies, ports/adapters style. Modules can evolve independently _inside_ the codebase.

Module isolation is enforced through **directory conventions and import rules**, not framework abstractions. Every architectural boundary maps to a file-system boundary that ESLint can police.

### Core Stack

| Layer | Technology |
|---|---|
| Runtime | Bun (>=1.x, pinned by lockfile in each project) |
| Backend | TypeScript on Bun |
| Backend API | Fastify |
| Backend DI | awilix |
| Serving | Single-origin SPA (Vite build → Fastify static files) |
| Frontend | Vue.js 3.5 |
| Frontend DI | Vue `provide` / `inject` (built-in) |
| UI Framework | Vuetify |
| Build Tooling (client) | Vite |
| Package Manager | bun (built-in) |
| Testing (full stack) | Vitest + Playwright |
| Property-Based Testing | fast-check |
| Source Control / Project Mgmt | GitHub (tickets, discussions) |
| Containerization | Docker |

### Technology Rationale

#### Why TypeScript (Full Stack)

- **Strong model performance with static typing.** Published benchmark summaries indicate TypeScript can be competitive with Python while preserving type safety. [ts-bench]
- **One language across the entire stack.** Frontend and backend share types, validation schemas, and domain models with zero translation layer. Agents never context-switch between language ecosystems.
- **Large effective training corpus.** TypeScript benefits from JavaScript ecosystem breadth, which generally improves generated code reliability for common patterns.
- **Favorable practical trajectory.** As model quality improves, TypeScript remains a strong default because it combines broad ecosystem familiarity with compile-time guardrails.
- **Architecture enforcement by design.** By encoding architectural rules as file-location conventions and import-path constraints, the type system and ESLint enforce module boundaries at edit-time — no custom compiler plugins required.

#### Why Bun

- **Active backing and ecosystem momentum.** Reports indicate Bun was acquired by Anthropic in December 2025, which may improve long-term support signals. [bun-acq-2025]
- **Native TypeScript execution.** No transpilation step, no `ts-node`, no build config. Write `.ts`, run it. One less tool for agents to misconfigure.
- **Fast tooling in common workflows.** Public comparisons often show materially faster package installs and startup for Bun in many workloads. [bun-install-speed] [bun-runtime-speed]
- **Node.js compatibility.** Bun aims for drop-in Node.js API compatibility. Fastify, Vitest, and the npm ecosystem run on Bun without changes. If a compatibility edge case surfaces, falling back to Node.js for that specific task is always an option.
- **All-in-one binary.** Runtime, package manager, bundler, and test runner in a single install. Fewer tools to install, fewer version mismatches, simpler CI setup.

**Important convention:** Write Node.js-compatible code. Do not use Bun-native APIs (`Bun.serve()`, `Bun.file()`, etc.). This keeps the codebase portable and ensures agents — whose training data is overwhelmingly Node.js — generate correct code by default. Bun is the runtime; the Node.js API is the interface.

#### Why Fastify

- **Plugin system is the module system.** Fastify's encapsulated plugin architecture maps directly to modulith boundaries. Plugins can't see each other's internal registrations unless explicitly shared — module isolation is a framework feature, not a convention to enforce.
- **First-class TypeScript support.** Full type inference for routes, request/reply schemas, and plugin decorations. Agents get type errors at edit-time when handler signatures don't match route schemas.
- **Schema-based validation with Zod.** Via `fastify-type-provider-zod`, request/response validation and TypeScript types derive from the same Zod schema — single source of truth, zero drift between runtime validation and compile-time types.
- **High representation in training data.** Fastify is well-documented and widely used in the Node.js/Bun ecosystem, with patterns agents generate reliably.

#### Why Vue.js + Vuetify

- Vue plays well with AI — less hidden context/state. More focused ecosystem compared with React, helping LLMs align on conventions.
- Vuetify is mature and widely-used with consistent component behaviour and styling. Strong official documentation and large real-world usage footprint — AI agents are less likely to invent APIs and more likely to generate working code patterns.
- Opinionated but coherent Material Design system (great for speed and UX consistency). Built-in theming for quick alignment of colours/typography without designing every component from scratch.
- _Choosing pragmatism over uniqueness._

#### Why No Tailwind CSS

Vuetify already provides a complete styling system: component library, theming engine, spacing/sizing utilities, responsive grid, and SASS variable customization. Adding Tailwind alongside Vuetify creates two competing styling paradigms — agents will inconsistently mix Vuetify's built-in classes with Tailwind utilities, producing code that is harder to maintain and lint. For one-off layout adjustments beyond what Vuetify provides, scoped CSS in Vue single-file components is the simpler and more predictable escape hatch.

---

### Dependency Injection

#### Backend — awilix

awilix provides the two things the modulith needs without introducing framework-level abstractions:

- **Auto-scanning and convention-based registration.** Agents can't forget to register a new service — awilix discovers and registers implementations by directory convention.
- **No decorators required.** awilix supports both class and function-based injection using pure constructor/parameter signatures. No experimental decorator syntax that agents may misapply.
- **Stays within standard idioms.** No separate container API to learn. Registration is explicit, resolution is transparent.

**Module boundary pattern:** each module exposes a single `registerModule(container)` function that scans its own directory and registers its services. The composition root in `app.ts` calls each module's registration function explicitly.

```typescript
// modules/orders/container.ts
export function registerOrdersModule(container: AwilixContainer) {
  container.register({
    orderService: asClass(OrderService).scoped(),
    orderRepository: asClass(OrderRepository).scoped(),
  });
}

// app.ts (composition root)
registerOrdersModule(container);
registerPaymentsModule(container);
```

#### Frontend — Vue's `provide` / `inject`

Vue's built-in `provide` / `inject` is sufficient. Adding a DI framework on top would fight the framework rather than work with it.

- **App-level `provide`** for cross-cutting concerns (API clients, auth, feature flags). Registered once at the app root or per-module plugin.
- **`inject` in composables and components** to consume dependencies — keeping components as black boxes that receive what they need through explicit seams.
- **Props and events** remain the primary interface for component-to-component communication.

This keeps the black-box testing model clean: in component tests, you `provide` mocks/stubs at the test wrapper level and the component under test doesn't know the difference.

---

### API & Page Serving

#### Single-Origin SPA served by Fastify

The Fastify application serves everything — it's both the API and the static file host for the Vite-built Vue SPA. One process, one port, one deployment.

**Development:** Vite dev server runs on its own port with HMR; `vite.config.ts` proxies `/api/*` to the Fastify process. One `bun run dev:server` + one `bun run dev:client`. Agents only need to know: "API is on Fastify, UI is on Vite, proxy connects them."

**Production:** `vite build` outputs static files → Fastify serves them via `@fastify/static` + SPA fallback → single process, single port, no CORS.

**Why not fully decoupled (separate SPA hosting)?** A separate static host sounds clean in theory but works against the architecture: two things to deploy (breaks the "single deployable" principle), CORS configuration becomes an agent trap, two dev servers to coordinate, and infrastructure divergence between dev and production that agents can't reason about.

**Why not SSR / Nuxt?** Nuxt adds a second server runtime alongside Fastify — two server processes to deploy, coordinate, and health-check. It contradicts the single-deployment philosophy. If SEO is eventually needed, build-time pre-rendering is the simpler escape hatch.

#### Endpoints — Fastify Plugins as Modules

Each modulith module registers its routes as an encapsulated Fastify plugin, mapping 1:1 to the module boundary.

```typescript
// modules/orders/routes.ts
import { z } from "zod";
import type { RouteRegistrar } from "../../shared/types";

const OrderDto = z.object({
  id: z.string().uuid(),
  item: z.string(),
  quantity: z.number().int().positive(),
});

const CreateOrderRequest = z.object({
  item: z.string().min(1),
  quantity: z.number().int().positive(),
});

export default (async function ordersRoutes(app) {
  app.get("/", {
    schema: { response: { 200: z.array(OrderDto) } },
    handler: async (request, reply) => {
      const service = request.diScope.resolve<OrderService>("orderService");
      return service.getAll();
    },
  });

  app.post("/", {
    schema: {
      body: CreateOrderRequest,
      response: { 201: OrderDto },
    },
    handler: async (request, reply) => {
      const service = request.diScope.resolve<OrderService>("orderService");
      const order = await service.create(request.body);
      reply.status(201);
      return order;
    },
  });
} satisfies RouteRegistrar);
```

One file per module's routes, Zod schemas co-located with handlers, DI resolution explicit. No decorators, no base classes, no registration to remember.

---

### Module Structure & Architectural Enforcement

#### Canonical Module Layout

```
modules/
  orders/
    index.ts              # barrel export — public API only
    routes.ts             # default-exports RouteRegistrar
    container.ts          # registerOrdersModule() function
    services/
      order.service.ts    # business logic
    domain/
      types.ts            # domain types and Zod schemas
      validation.ts       # domain validation rules
    infrastructure/
      order.repository.ts # data access
  payments/
    index.ts
    routes.ts
    container.ts
    services/
    domain/
    infrastructure/
shared/
  types.ts                # shared type definitions (RouteRegistrar, etc.)
  middleware/              # cross-cutting Fastify hooks
contracts/
  orders-payments.contract.test.ts  # cross-module contract tests
```

#### Module Scaffolding

New modules are created via a scaffold command, not by hand. This eliminates the risk of agents forgetting required files or producing inconsistent structures.

```bash
forge scaffold module <name>
```

This generates the canonical layout for the named module: `index.ts`, `routes.ts`, `container.ts`, and the `services/`, `domain/`, and `infrastructure/` directories with placeholder files. The generated `container.ts` includes a correctly-named `register<Name>Module` function. The generated `routes.ts` includes a default-exported `RouteRegistrar` skeleton.

Agents should always use the scaffold command when creating a new module rather than creating files individually.

#### Shared Types Governance

The `shared/types.ts` file is reserved for types that are genuinely cross-cutting: framework-level contracts (`RouteRegistrar`, `ModuleRegistrar`), shared middleware interfaces, and error types. Module-specific types that happen to be used by other modules belong in the producing module's `index.ts` barrel export, not in `shared/`.

**Decision criteria for where a type lives:**

- Is it a framework contract that all modules implement? → `shared/types.ts`
- Is it a domain concept owned by one module but consumed by others? → Producing module's `index.ts`
- Is it used by only one module? → That module's `domain/types.ts`

When a shared type changes, the producing module's barrel export ensures that consumers get compile-time errors immediately. Breaking changes to `shared/types.ts` require explicit coordination (captured as a task in the plan).

#### ESLint Rules that Enforce Architecture

These rules run via typescript-eslint's type-aware mode and surface as real-time diagnostics through the LSP. Agents see violations as red squiggles at edit-time.

1. **Module isolation (no deep imports):** No file outside `modules/orders/` may import from anything except `modules/orders/index.ts`. All cross-module access goes through the barrel export.
2. **Layer enforcement (dependency direction):** Files in `domain/` cannot import from `infrastructure/`. The dependency arrow points inward: infrastructure → services → domain.

```jsonc
// eslint rule: import/no-restricted-paths
{
  "zones": [
    { "target": "./modules/*/domain/**", "from": "./modules/*/infrastructure/**" },
    { "target": "./modules/*/domain/**", "from": "./modules/*/routes.*" }
  ]
}
```

3. **Export shape constraints:** Every `routes.ts` must default-export a value. Every `container.ts` must export a named function matching `register*Module`.
4. **No `any` types anywhere:** `@typescript-eslint/no-explicit-any` as an error, not a warning.
5. **No cross-module infrastructure access:** A module's `infrastructure/` directory is private to that module. Only `services/` within the same module can import from it.

#### Enforcement Coverage

**What structural enforcement covers (~60-70% of Roslyn-equivalent):** Module boundary isolation, layer dependency direction, public API surface control, type safety (`tsc` strict mode), naming and structural conventions, route and container file existence.

**What falls to tests and human review (~30-40%):** DI graph completeness (integration test that boots the container), cross-module semantic consistency (BDD scenarios), correct handler behavior (unit/integration tests), business logic correctness (always requires human judgment).

**Realistic expectations for v1:** Early in a project's lifecycle, expect the human-review share to be closer to 50%. Agents will hit edge cases in ESLint rules, produce code that passes all gates but is subtly wrong, or generate documentation that is technically complete but misleading. The structural-to-human ratio improves as the codebase grows and conventions become more established, but plan for meaningful human oversight in the first few cycles.

---

### Testing Strategy

The testing philosophy is consistent across the entire stack. One framework (Vitest) for unit, component, and integration tests. Playwright for e2e.

#### Code-First BDD — Vitest

Code-first BDD over Gherkin for the following reasons:

- **Compile-time feedback beats runtime surprises.** In Gherkin, the binding between a step and code is string matching. If an agent renames something, it can silently create an unbound step. In code-first BDD, renames break at compile time, which agents can repair deterministically.
- **Refactoring is mechanically safer.** Agents refactor aggressively. Code-first stays inside TypeScript tooling — the compiler enforces correctness.
- **Less surface area for brittle conventions.** Gherkin stacks accumulate step regexes, shared step libraries, ambiguous matches. Agents create those accidentally because it "looks DRY".
- **Easier to keep the scenario layer thin.** Scenario = orchestration, reusing typed drivers/fixtures.

```typescript
describe("Order creation", () => {
  it("should create an order and return it with an ID", async () => {
    // Given
    const app = await buildTestApp();
    const request = { item: "Widget", quantity: 5 };

    // When
    const response = await app.inject({
      method: "POST",
      url: "/api/orders",
      payload: request,
    });

    // Then
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      item: "Widget",
      quantity: 5,
      id: expect.any(String),
    });
  });
});
```

#### Why Vitest

**Over Bun's built-in test runner:** Test isolation by default (Bun leaks mocks between suites), better async test performance, feature completeness (fake timers, browser mode, sharding), and Vue ecosystem integration (shares Vite's config).

**Over Jest:** Native TypeScript and ESM support (no transpilation config), same config as Vite, fast watch mode with HMR-like re-execution, first-class workspace support.

Note: Vitest runs on Bun's runtime, getting Bun's fast startup and TypeScript execution. The combination gives you Vitest's mature test features with Bun's runtime speed.

#### Property-Based Testing — fast-check

- Most mature PBT library in the TypeScript ecosystem. Stable, well-documented, fewer ecosystem gotchas.
- Excellent Vitest integration via `@fast-check/vitest` — properties look like normal test methods.
- Good shrinking and actionable counterexamples, making the agent loop (fix code → rerun) fast and deterministic.

**Guidance for writing useful properties:** Agents tend to generate trivial properties ("output is defined", "doesn't throw") that pass gates but provide no value. The plan should specify properties drawn from the following taxonomy:

- **Round-trip / encode-decode:** `deserialize(serialize(x)) === x`
- **Idempotence:** `f(f(x)) === f(x)` (e.g., normalization, formatting)
- **Invariant preservation:** "the total of line items always equals the order total"
- **Commutativity / associativity:** order of operations doesn't change result
- **No invalid state representable:** generated inputs within the Zod schema always produce valid domain objects
- **Oracle comparison:** simplified reference implementation produces same result as optimized one

```typescript
import { test, fc } from "@fast-check/vitest";

test.prop([fc.string({ minLength: 1 }), fc.integer({ min: 1 })])(
  "creating an order always returns an ID",
  async (item, quantity) => {
    const app = await buildTestApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/orders",
      payload: { item, quantity },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().id).toBeDefined();
  }
);
```

#### Cross-Module Contract Tests

When module A depends on an interface exposed by module B's barrel export, a contract test must verify that B's implementation satisfies the contract A relies on. These tests live in the `contracts/` directory at the project root (outside any single module) and import only from barrel exports.

Contract tests prevent a common failure mode: module B's implementation changes in a way that is type-compatible but semantically incompatible with module A's expectations.

```typescript
// contracts/orders-payments.contract.test.ts
import { OrderService } from "../modules/orders";
import { PaymentGateway } from "../modules/payments";

describe("Orders-Payments contract", () => {
  it("PaymentGateway.charge returns a receipt that OrderService can record", async () => {
    // ...
  });
});
```

#### E2E — Playwright Test

Playwright Test for end-to-end testing. Exercises the full application as a single black box: user clicks, sees results.

#### Black-Box Testing Model

All tests — e2e, component, and unit — are treated as **black-box tests at different scales**. The system is one large black box; component and unit tests simply split it into smaller black boxes, each tested through its public interface.

- **E2E tests** exercise the full application (user clicks, sees results).
- **Component tests** exercise an isolated component (props, events, slots, rendered output — never internal state).
- **Unit tests** exercise a single function or composable (inputs in, outputs out).

This framing keeps every test level focused on **behaviour, not implementation**, which means agents can refactor internals freely without breaking tests.

---

### Static Analysis

#### TypeScript Compiler — The Hard Gate

- `tsc --noEmit` with strict mode. All strict flags enabled: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`.
- Types are not optional. No `any` escapes. Every function boundary, every module contract, every API schema is typed.
- Zod schemas and domain types compose naturally via structural typing — no separate "runtime types vs compile-time types" problem.

#### ESLint — Architectural Enforcement

- typescript-eslint in type-aware mode for rules that go beyond syntax.
- Custom rules for architectural conventions (module boundaries, layer direction, export shapes).
- `eslint-plugin-import` for dependency graph rules (`no-restricted-paths`, `no-cycle`).

#### CI Verification

- **Module completeness check:** CI script verifies every directory under `modules/` contains required files (`index.ts`, `routes.ts`, `container.ts`).
- **DI container boot test:** Integration test that instantiates the full DI container and resolves every registered service.

---

### Frontend Architecture

One repo, one build pipeline, one deployment (per environment). Strong module boundaries inside the app (feature folders / domains). Shared design system and component library (versioned in-repo). Optional: split into multiple apps (MPA) only if routes are truly independent.

This gives you the benefits people want from microfrontends (team velocity, code ownership, reuse) without the runtime and operational tax.

---

### Agent Feedback Loop

The stack is designed to give agents **three layers of feedback**, each catching what the layer above can't:

1. **Type checker + ESLint (instant, at edit-time via LSP).** Catches type errors, import violations, structural convention breaches. Agent sees red squiggles immediately and can self-correct.
2. **Tests (seconds, on save or on demand).** Catches behavioral errors, DI resolution failures, integration issues. Agent runs tests after each change and iterates.
3. **Human review (asynchronous).** Catches business logic correctness, security implications, and genuinely subjective design decisions.

Each layer is deterministic except the last. The goal is to push as much validation as possible into layers 1 and 2, so that layer 3 (human review) is only needed for decisions that require human judgment.

#### Feedback Loop Observability

The orchestrator tracks metrics across the feedback loop to identify where the spec's assumptions break down:

- **Gate failure frequency** — which gates fail most often, by type and by task
- **Retry rate per task** — tasks that consistently need retries indicate under-specified requirements or architectural gaps
- **Failure category distribution** — transient (flaky test, network timeout) vs. structural (type error, lint violation) vs. semantic (wrong behavior)
- **Time-to-green per step** — how long each TDD step takes, flagging tasks that exceed expected duration

This data feeds back into plan quality: if a particular module or pattern consistently causes failures, the planning phase should account for that complexity.

---

## Part II: The Orchestrator

With the stack providing deterministic signals, the orchestrator defines how work flows from idea to merged code. Three phases, each with explicit gates.

### Orchestrator Design Principle: Transparent Automation

The orchestrator drives the development loop programmatically — context injection, gate checking, task progression — but never hides what the agent is doing. All agent output streams to the user's terminal in real time. The user retains full visibility and can intervene at any point.

This is not a wrapper around Claude Code, Codex, or any specific agent runtime. It is a **companion process** that controls the workflow while the agent terminal remains fully visible and accessible.

---

### Phase 1: PLAN

**Objective**: Converge on a concrete, executable plan through iterative refinement.

**Mode**: Conversational loop — agent asks, researches, proposes; user refines. Repeat until approved.

Within the loop, the agent naturally moves through these concerns (not rigid sub-phases):

1. **Understand** — Ask questions until the problem is clear. Goals, constraints, edge cases, tech preferences.
2. **Research** (optional, skippable) — Investigate technologies, patterns, similar implementations. Spawn parallel research agents if needed.
3. **Specify** — Extract requirements (functional + non-functional), define scope (v1 / v2 / out of scope), write BDD scenarios and domain invariants.
4. **Resolve ambiguity** — Surface gray areas, capture user preferences on implementation details (UX, error handling, API design, architecture decisions).
5. **Structure** — Break into atomic tasks with execution order, define file structure (following the canonical module layout), identify dependencies between tasks.

#### Plan Checker Loop

Before presenting the plan to the user, an automated checker agent validates:

- Every requirement is covered by at least one task
- Tasks have clear acceptance criteria and verification commands
- Dependencies between tasks are acyclic and complete
- No task exceeds default size limits (`max_files_per_task: 8`, `max_estimated_lines_per_task: 400`) unless explicitly justified in the plan
- BDD scenarios exist for all behavioral requirements
- Tasks reference files that conform to the canonical module layout
- Property test specifications use patterns from the taxonomy (round-trip, idempotence, invariant preservation, etc.) — not trivial assertions

If validation fails, the planning agent revises and re-submits. This loop runs until the checker passes — only then does the plan go to the user for review.

```
Agent proposes plan
  └→ Checker validates against requirements
       └→ FAIL → Agent revises → re-check
       └→ PASS → Visualize → Present to user
            └→ User refines → Agent updates → re-check
            └→ User approves → advance to EXECUTE
```

#### Plan Visualization

The approved plan is rendered as a workflow visualization (DAG) showing tasks as nodes, dependencies as edges, parallel execution waves, and current progress during execution.

The output is a single approved artifact — the **Plan** — not five separate documents.

**Plan Schema:**

```yaml
Plan:
  metadata:
    project: string
    created: datetime
    last_updated: datetime
    spec_version: string
    approved: boolean
  context:
    goals: string[]
    constraints: string[]
    tech_decisions: Record<string, string>   # e.g. { "auth": "jose over jsonwebtoken" }
    architecture: modulith                    # always modulith for Forge projects
  tasks:
    - id: string
      type: implementation | spike            # spike = time-boxed exploration
      name: string
      description: string
      files: string[]                         # files to create/modify (must follow canonical layout)
      dependencies: string[]                  # task IDs this depends on
      time_box: string | null                 # only for spikes: max duration (e.g. "2h")
      tests:
        bdd_scenarios: string[]               # code-first BDD scenario descriptions
        property_invariants: string[]         # fast-check property descriptions (with taxonomy tag)
        contract_tests: string[]              # cross-module contract test descriptions
      acceptance_criteria: string[]
      verification_command: string            # how to prove it works
```

#### Spike Tasks

A spike is a time-boxed exploratory task that produces **learning**, not shippable code. Spikes are used when the plan encounters unknowns that can't be resolved through research alone: unfamiliar APIs, performance characteristics that need measurement, integration approaches that need prototyping.

Spikes differ from implementation tasks:

- **Output is a decision, not a commit.** The spike produces a finding that informs subsequent tasks (captured as a `tech_decision` in the plan context). Any code written during a spike is throwaway.
- **Gates are relaxed.** Spikes don't require passing the full Red→Green→Refactor cycle. They require only that the finding is documented and the time box is respected.
- **Time-boxed.** If the spike exceeds its time box without a clear finding, it escalates to the user rather than retrying.

```yaml
- id: spike-auth-strategy
  type: spike
  name: "Evaluate jose vs jsonwebtoken for JWT handling"
  description: "Compare API ergonomics, bundle size, and agent code generation reliability"
  time_box: "1h"
  acceptance_criteria:
    - "Documented comparison with recommendation"
    - "tech_decisions updated with chosen library"
  verification_command: "test -f decisions/auth-jwt-library.md"
```

#### Plan Revision Protocol

Plans are living documents during execution. When a task reveals that an earlier decision was wrong, or when the user needs to change direction mid-execution, the plan revision protocol applies:

1. **Pause** — execution stops after the current task completes (or immediately if the user triggers `forge pause`).
2. **Snapshot** — the orchestrator records the current state: which tasks are complete, which are in progress, current git SHA.
3. **Revise** — the user and planning agent modify the remaining tasks. Completed tasks are not replayed. New tasks can be inserted, existing tasks reordered or removed.
4. **Re-check** — the plan checker validates the revised plan (same rules as initial planning).
5. **User approves delta** — the user sees a diff of what changed in the plan and explicitly approves.
6. **Resume** — execution continues from the next incomplete task.

The orchestrator tracks plan revisions as entries in the execution log, not as versioned plan documents. The plan is always the current state, not a history.

**Gate**: User explicitly approves the plan. No implicit approval, no auto-advance.

**Artifacts**: `PLAN.md` (or structured format), research notes if applicable.

---

### Phase 2: EXECUTE

**Objective**: Implement the plan task by task with full test coverage.

**Key constraint**: Fresh context per task. No accumulated context rot. Each task gets a clean agent session with only the plan and relevant codebase context.

#### Interaction Model

The orchestrator supports three execution modes that share the same underlying architecture — the only difference is where the orchestrator pauses for user input.

```yaml
execution:
  mode: auto | supervised | manual
```

**Auto mode** — The orchestrator drives the full loop: fresh context per task, automated gates, progression without user intervention. Agent output streams to the terminal in real time. The user can interrupt at any point (Ctrl+C or `forge pause`) but is not required to be present. This is the Ralph-loop mode.

**Supervised mode** — Same as auto, but the orchestrator pauses after each completed task and waits for the user to approve before advancing. This is the recommended default for v1 until the user trusts the system's judgment.

**Manual mode** — The orchestrator generates context prompts and tracks state, but the user drives execution entirely. The user starts each agent session, runs commands, and signals task completion. The orchestrator serves as a checklist manager and gate checker, not a loop controller.

#### Transparent Execution

Regardless of mode, the orchestrator never hides agent activity. The agent terminal output streams to the user in real time. The orchestrator controls what goes in (prompts, context, tool permissions) and what happens between tasks (gates, context clearing, progression), but every command the agent runs, every file it edits, and every reasoning step it takes is visible.

```
┌─────────────────────────────────────────────┐
│  Forge Orchestrator                         │
│  Controls: prompt injection, context reset, │
│            gate checks, loop progression    │
│                                             │
│  for task in plan.tasks:                    │
│    prompt = build_context(task, plan)       │
│    run_agent(prompt)        ──────────────────► streams to terminal
│    run_gates(task.step)                     │
│    if gates_fail: classify + retry or pause │
│                                             │
│  User can:                                  │
│    • Watch everything live                  │
│    • Ctrl+C to interrupt mid-task           │
│    • `forge pause` between tasks            │
│    • `forge recover` to resume interactive  │
│      session for manual repair              │
│    • `forge resume` to continue automation  │
└─────────────────────────────────────────────┘
```

#### Recovery Model: Filesystem-Mediated, Not Session-Mediated

When a task fails or the user interrupts, recovery is mediated through the filesystem and git state — not through shared agent sessions. This is a deliberate design choice that aligns with the "fresh context per task" principle.

**How recovery works:**

1. The orchestrator runs each task via the agent's machine interface (e.g., `claude -p` or Codex `app-server`), capturing a resume token when available.
2. Agent output streams to the user's terminal in real time.
3. If something goes wrong (gate failure, user interrupt, context overflow):
   - The orchestrator saves the resume token (if supported) and current task state.
   - Claude Code: the user can open an interactive session using the saved session ID (`claude --resume <id>`) to inspect what happened and manually fix files.
   - Codex app-server: current implementation does not support interactive resume from a persisted thread; recovery is filesystem-mediated (fix files, rerun).
4. When the user signals readiness (`forge resume`), the orchestrator starts a **fresh** programmatic session for the next task, reading the current filesystem state.

The orchestrator and the user never share a live agent session. They share a filesystem and git history. This avoids the fragile problem of two processes trying to coordinate inside a single agent context, and it means a corrupted or overflowed context from a failed task never poisons subsequent work.

```yaml
execution:
  recovery:
    expose_session_id: true       # always show session ID for manual resume
    checkpoint_on_interrupt: true  # git stash or checkpoint before pause
    resume_from: filesystem       # always read current file state, never inherit session
```

**Agent runtime compatibility:**

| Capability | Claude Code | Codex app-server |
|---|---|---|
| Non-interactive execution | `claude -p` | `codex app-server` |
| Session ID capture | Agent SDK `init` event | Thread ID (not yet persisted for resume) |
| Interactive resume | `claude --resume <id>` | Not supported (rerun with filesystem state) |
| Session fork | `--fork-session` | New thread |
| Output streaming | `--output-format stream-json` | JSON-RPC notifications (JSONL) |
| Tool permissions | `--allowedTools` | `approvalPolicy` |

**Known limitation:** In Claude Code's non-interactive mode, if a single tool call exceeds the context limit, the session becomes irrecoverable (no programmatic equivalent of interactive mode's Esc+Esc rewind). The orchestrator mitigates this by keeping tasks small (enforced by plan checker size limits) and by providing the filesystem recovery path as a fallback.

#### Per-Task Cycle

For each task in the plan (respecting dependency order):

```
SPEC  →  IMPLEMENT  →  REFACTOR  →  DOCUMENT  →  COMMIT
```

##### Step 1: SPEC (Red)

Write failing tests before any implementation code.

- **Code-first BDD scenarios** — Behavioral specifications from the plan, written as Vitest `describe`/`it` blocks with Given/When/Then comments
- **Property tests** — Domain invariants via fast-check that must always hold
- **Unit test shells** — Expected interfaces and behaviors

**Guidance for writing good failing tests:** Tests written before implementation should anchor to **stable prediction targets** — Zod schemas, route contracts, and domain interfaces — rather than guessing at internal implementation details. If a test requires knowledge of an implementation that doesn't exist yet, it's testing at the wrong level of abstraction.

**Gate**: Tests compile/parse (TypeScript, `tsc --noEmit` passes). All tests RED (failing). If any test passes before implementation, the test is wrong or trivial — fix it.

##### Step 2: IMPLEMENT (Green)

Write the minimum code to pass all tests, following the modulith structure.

- Domain logic first (pure business rules in `domain/`, no external imports)
- Ports (technology-agnostic interfaces in `domain/types.ts`)
- Adapters (real implementations in `infrastructure/`)
- Services (orchestration in `services/`)
- Fakes (test implementations of ports, for use in domain tests)

**Architecture rules** (enforced at gate by ESLint + `tsc`):

- Domain NEVER imports from infrastructure (ESLint `import/no-restricted-paths`)
- Domain NEVER imports external libraries (except shared types)
- All dependencies point inward
- No `any` types (`@typescript-eslint/no-explicit-any`)
- Use Fakes for domain testing, Mocks only at adapter boundaries
- All Zod schemas co-located with their routes or domain types

**Gate**: All tests GREEN. `tsc --noEmit` passes. ESLint passes. No warnings.

##### Step 3: REFACTOR

Clean up without changing behavior.

- Remove duplication
- Improve naming
- Enforce architecture constraints (verify no domain→adapter imports)
- Simplify complex logic
- Ensure barrel exports (`index.ts`) expose only the public API

**Gate**: All tests still GREEN. No regressions. Architecture rules still hold. ESLint clean.

##### Step 4: DOCUMENT

Generate documentation while implementation is fresh in context.

- Inline code documentation (doc comments on public interfaces)
- API documentation (if task exposes endpoints — Zod schemas serve as living docs)
- Decision records (why, not just what — captured in `decisions.md`)
- Update any existing docs affected by this task

**Gate**: Documentation matches implementation (public methods have docs, API endpoints are documented, decision log updated).

##### Step 5: COMMIT

- Atomic commit for this task only
- Commit message follows convention: `type(scope): description`
- Push to remote after commit

**Gate**: Commit is clean (no untracked files, no partial changes). Push succeeds.

#### Failure Classification

Not all gate failures are equal. The orchestrator classifies failures before deciding how to respond:

| Category | Examples | Response |
|---|---|---|
| **Transient** | Flaky test, network timeout, filesystem race | Retry immediately (up to 2 times) |
| **Structural** | Type error, lint violation, missing file | Retry with agent (up to `max_retries_per_task`) |
| **Semantic** | Wrong behavior, test logic error, design mistake | Pause and surface to user |
| **Infrastructure** | Context overflow, agent crash, OOM | Pause, expose session ID for recovery |

This classification prevents burning retries on failures that an agent can't self-correct (semantic errors, infrastructure failures) while allowing quick recovery from transient issues.

#### Execution Modes

- **Sequential**: Tasks execute in dependency order, one at a time
- **Parallel** (auto mode only, where supported): Independent tasks can run in parallel waves, each in its own fresh context. Parallel execution in v1 requires the user to manage multiple terminals; the orchestrator tracks state but doesn't multiplex terminals.

#### Quality Gates Summary

| Gate | When | What it checks | Canonical command |
|------|------|----------------|-------------------|
| `gate:spec` | After writing tests | Tests compile (`tsc`), all failing | `bun run typecheck && bun run test -- --runInBand --passWithNoTests=false` |
| `gate:green` | After implementation | All tests pass, `tsc` clean, ESLint clean | `bun run test && bun run typecheck && bun run lint` |
| `gate:refactor` | After cleanup | Tests still pass, architecture rules hold | `bun run test && bun run typecheck && bun run lint` |
| `gate:docs` | After documentation | Public interfaces documented | `bun run docs:check` |
| `gate:commit` | Before commit | Clean working tree, all checks pass | `git status --porcelain` |
| `gate:verify` | End-to-end verification | Full verification suite passes | `bun run test && bun run typecheck && bun run lint && bun run test:e2e && bun run security:scan` |

---

### Phase 3: VERIFY

**Objective**: Validate the complete implementation across task boundaries.

This phase runs once after all tasks are executed, covering concerns that span multiple tasks.

#### Automated Verification

1. **Full test suite** — All property tests, BDD scenarios, unit tests pass (`bun run test`)
2. **Type check** — `tsc --noEmit` across entire codebase
3. **Lint** — ESLint with architectural rules across entire codebase
4. **Module completeness** — CI script verifies every module has required files
5. **DI container boot** — Integration test resolves every registered service
6. **Contract tests** — Cross-module contracts hold; fakes match real adapter implementations
7. **Integration tests** — Components work together correctly
8. **E2E tests** — Critical user paths via Playwright
9. **Security scan** — No known vulnerabilities, secrets, or unsafe patterns
10. **Architecture audit** — Dependency rules hold across entire codebase (`no-cycle`, `no-restricted-paths`)

#### User Acceptance Testing (UAT)

Agent extracts testable deliverables from the plan and walks the user through them:

- Present each deliverable one at a time
- User confirms pass/fail
- If failures: agent diagnoses root cause, creates fix tasks, loops back to EXECUTE via the plan revision protocol

#### Finalize

1. Generate/update project documentation
2. Update decision log
3. Create Pull Request (auto-generated description from plan + task summaries)
4. Generate execution summary with logs

**Gate**: All automated checks pass AND user approves UAT.

---

## Logging

Structured logs at three levels:

| Level | What's captured |
|-------|----------------|
| **Plan** | Questions asked, research findings, plan iterations, plan revisions, final approved plan |
| **Task** | Test results per step, gate pass/fail, failure classification, retry count, timing, files changed, session IDs |
| **Step** | Detailed agent actions, commands run, outputs |

Logs persist across sessions for debugging and auditability. The observability metrics (gate failure frequency, retry rates, failure categories, time-to-green) are derived from these logs.

---

## Configuration

### Compatibility Floors

| Tool | Minimum Supported Version |
|------|---------------------------|
| Bun | `>=1.x` |
| TypeScript | `>=5.x` |
| Vue | `>=3.5` |
| Fastify | `>=5.x` |
| Vitest | `>=2.x` |
| Playwright | `>=1.x` |

Exact versions are pinned by lockfile and CI image tags; these floors define minimum compatibility expectations.

```yaml
config:
  versions:
    bun: ">=1.x"
    typescript: ">=5.x"
    vue: ">=3.5"
    fastify: ">=5.x"
    vitest: ">=2.x"
    playwright: ">=1.x"

  models:
    planning: opus          # Model for the planning loop
    execution: sonnet       # Model for per-task execution
    verification: sonnet    # Model for verification phase

  planning:
    checker:
      max_files_per_task: 8
      max_estimated_lines_per_task: 400

  execution:
    mode: supervised        # auto | supervised | manual (supervised is the v1 default)
    fresh_context: true     # New agent session per task (always true)
    max_retries_per_task: 3 # Retries before asking the user (structural failures only)
    stream_output: true     # Always pipe agent output to user terminal

    recovery:
      expose_session_id: true       # Always show session ID for manual resume
      checkpoint_on_interrupt: true  # Git stash or checkpoint before pause
      resume_from: filesystem       # Always read current file state, never inherit session

    failure_classification:
      transient_max_retries: 2      # Quick retries for flaky/transient failures
      structural_max_retries: 3     # Agent retries for type/lint errors
      semantic_action: pause        # Always pause for semantic failures
      infrastructure_action: pause  # Always pause for context overflow, crashes

  agent:
    runtime: claude-code    # claude-code | codex
    # Runtime-specific settings are derived from the runtime choice
    # claude-code: uses `claude -p`, `--resume`, `--allowedTools`
    # codex: uses `codex app-server` (JSON-RPC), `approvalPolicy`

  git:
    commit_per_task: true
    push_per_task: true
    create_pr: true
    remote: origin
    pr:
      target_branch: main
      auto_create: true
      description_from: plan+summaries
    provider: github        # github

  quality:
    architecture: modulith          # Architecture style to enforce
    require_bdd: true               # BDD scenarios mandatory per task
    require_property_tests: true    # Property tests mandatory for domain logic
    require_contract_tests: true    # Contract tests mandatory for cross-module interfaces
    security_scan: true             # Run security scan in verify phase

  workflow:
    research: true
    skip_research_flag: --skip-research

  commands:
    scaffold_module: "forge scaffold module"
    gate_spec: "bun run typecheck && bun run test -- --runInBand --passWithNoTests=false"
    gate_green: "bun run test && bun run typecheck && bun run lint"
    gate_refactor: "bun run test && bun run typecheck && bun run lint"
    gate_docs: "bun run docs:check"
    gate_commit: "git status --porcelain"
    verify: "bun run test && bun run typecheck && bun run lint && bun run test:e2e && bun run security:scan"

  observability:
    track_gate_failures: true
    track_retry_rates: true
    track_failure_categories: true
    track_time_to_green: true

  archival:
    keep_plan_text: true            # Archive text-only plan after execution
    delete_transitive_data: true    # Delete checker state, DAG state, etc.

  ide:
    open_diff_after_commit: false
    editor: vscode          # vscode | cursor | none
```

---

## Automation Model

Once a plan is approved, execution proceeds according to the configured mode:

```
User approves plan
  └→ For each task (respecting dependencies):
       └→ Generate task context (prompt, relevant files, architectural rules)
       └→ Run agent in non-interactive mode (claude -p / codex exec)
            └→ Output streams to user terminal in real time
            └→ Spec → Implement → Refactor → Document → Commit
            └→ If gate fails → classify failure:
                 └→ Transient → retry immediately (up to 2x)
                 └→ Structural → retry with agent (up to max_retries)
                 └→ Semantic/Infrastructure → pause, expose session ID
                      └→ User can: `forge recover` → interactive resume
                      └→ User fixes files manually
                      └→ User runs: `forge resume` → next task from filesystem state
       └→ [supervised mode] Pause after task, wait for user approval
  └→ Verify phase runs
       └→ Automated checks (tsc, ESLint, tests, DI boot, contracts, e2e, security)
       └→ UAT (user interaction required)
  └→ Archive plan text, delete transitive data
  └→ Create PR
```

**User touchpoints by mode:**

| Mode | Plan Phase | Execute Phase | Verify Phase |
|------|------------|---------------|--------------|
| **Auto** | Active (approve/refine) | Passive (can interrupt) | UAT confirmation |
| **Supervised** | Active (approve/refine) | Approve each task | UAT confirmation |
| **Manual** | Active (approve/refine) | Drive everything | UAT confirmation |

---

## User Interface

### Plan Refinement

During the PLAN phase, the user interacts through a conversational interface: see the current state of the plan, refine requirements iteratively, view the plan visualization (DAG) before approving, approve/reject/request changes to specific tasks.

### Execution Monitoring

During EXECUTE, the user has visibility into: which task is currently running, current step (Spec / Implement / Refactor / Document / Commit), gate pass/fail status with failure classification, live agent output streaming to terminal, session IDs for each task (for manual recovery), ability to **pause** execution between tasks (`forge pause`), ability to **recover** into an interactive session (`forge recover`), ability to **resume** automated execution (`forge resume`), ability to trigger **plan revision** without restarting (`forge revise`).

### Sidecar Status (Optional)

A lightweight status display (terminal UI, tmux pane, or web dashboard) that shows gate status alongside the agent terminal:

```
Task 3/7: Create order service    [IMPLEMENT]
  TypeScript:  ✓ passing
  ESLint:      ✗ 2 violations (import/no-restricted-paths)
  Tests:       14/17 green
  Session:     abc123-def456
```

The sidecar is informational only — it doesn't control execution.

### IDE Integration

Open diffs in VS Code (or configured editor) after each task commit. Allow the user to review changes before the next task begins (optional, configurable).

---

## Infrastructure & Tooling

### Execution Runtime

Development is local. The agent (Claude Code, Codex, or equivalent) runs against the local filesystem and toolchain directly.

| Concern | Decision | Notes |
|---------|----------|-------|
| **Agent runs** | Local process | Non-interactive CLI (`claude -p` / `codex exec`) |
| **Fresh context** | New agent session per task | Clean prompt, not a new container |
| **User visibility** | Output streaming | All agent output piped to user terminal |
| **Recovery** | Session ID + filesystem | User resumes interactively, orchestrator reads filesystem |
| **CI / Verification** | Docker container | Reproducible environment for tests, lint, type check |
| **Git credentials** | Local git config | SSH keys or credential helper, already configured |
| **Tool access** | Bun, tsc, ESLint, Vitest, Playwright | Must be installed locally; mirrored in CI image |

### CI Container

A single Docker image provides the reproducible environment for CI. It includes the full toolchain (Bun, Node.js compatibility layer, Playwright browsers) and runs the same verification commands that agents run locally. What passes locally must pass in CI.

---

## Design Decisions

### Execution Environment

**Development happens locally.** Agents (Claude Code, Codex, or equivalent) run against the local filesystem and toolchain. There is no container-per-task isolation during development — the "fresh context" constraint is achieved by spawning a new agent session with a clean prompt, not by spinning up a new container.

**CI runs in a container.** A Docker image provides the reproducible environment for tests, linting, type checking, and security scans. This is the same image used by the PR pipeline — what passes locally must pass in CI.

**Agent isolation (v1 limitation):** Unattended execution in Forge v1 is supported only in host environments that provide scoped project-level permissions (for example command allowlists and directory sandboxing). Where that is unavailable, execution must run in supervised mode with explicit approvals. A portable cross-runtime standard remains open (see Open Questions).

### Task Failure Handling

Failures are classified before retry decisions are made (see Failure Classification in Phase 2). Transient failures retry immediately. Structural failures retry with the agent. Semantic and infrastructure failures pause and surface to the user with the session ID for manual recovery.

```yaml
config:
  execution:
    failure_classification:
      transient_max_retries: 2
      structural_max_retries: 3
      semantic_action: pause
      infrastructure_action: pause
```

### Plan Archival

Plans are not versioned. After execution completes (or is abandoned), the text-only portion of the plan is archived for reference. All transitive data generated during plan execution (checker state, intermediate validation results, DAG execution state) is deleted. The archived plan serves as a historical record, not a replayable artifact. Plan revisions made during execution are captured in the execution log.

### Scope Boundaries

The following are explicitly **out of scope** for Forge:

- **Multi-repo tasks.** This is a monorepo-first approach. Cross-repository coordination is rare and handled manually when it arises.
- **Cost management / token budgets.** No built-in cost tracking or limits. Fresh context per task is the default; optimizing token spend is a future concern.
- **Research caching across agent sessions.** In V1, research findings from the planning phase are not automatically available to execution agents. If needed, relevant findings should be captured in the plan itself. This is a future enhancement.
- **Database migrations and stateful resources.** The framework does not prescribe a migration tool or strategy. The *workflow* for managing schema changes (ordering, rollback, seed data) should be captured as `tech_decisions` in the plan on a per-project basis, alongside the database choice itself.
- **Terminal multiplexing.** The orchestrator does not manage multiple terminals for parallel execution. In v1, parallel tasks require the user to manage separate terminal windows.

### Project-Specific Decisions

The framework deliberately does **not** prescribe choices for:

- **Database layer** — depends on the project (PostgreSQL, SQLite, etc.)
- **Auth / session management** — depends on the project (JWT, sessions, OAuth, etc.)
- **Database migration strategy** — depends on the database and project complexity

These are captured as `tech_decisions` in the plan's context during the PLAN phase, on a per-project basis.

### Build Orchestration

Bun scripts + Vitest workspaces are sufficient. No additional monorepo tooling (Nx, Turborepo) is required. If build orchestration becomes a bottleneck at scale, this can be revisited.

## Open Questions

1. **Agent isolation strategy (v1 limitation)** — Forge v1 only supports unattended execution in host environments that provide scoped project-level permissions (for example command allowlists and directory sandboxing). The open question is which cross-runtime isolation standard should be adopted so this guarantee is portable without relying on blanket dangerous mode.
2. **Parallel execution UX** — In v1, parallel task execution requires the user to manage multiple terminals manually. A future version could integrate with tmux or a custom terminal multiplexer, but the orchestrator's state tracking must be proven in sequential mode first.
3. **Session recovery reliability** — The `--resume` capability in both Claude Code and Codex has known edge cases (context overflow, stale session state). The filesystem-mediated recovery model is the primary path; session resume is a convenience for debugging, not a reliability guarantee. Monitor how often session resume fails in practice and whether additional recovery mechanisms are needed.
