<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/OpenSymbolicAI/.github/main/profile/opensymbolicai-horizontal-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/OpenSymbolicAI/.github/main/profile/opensymbolicai-horizontal.svg">
    <img alt="OpenSymbolicAI" src="https://raw.githubusercontent.com/OpenSymbolicAI/.github/main/profile/opensymbolicai-horizontal.svg" height="48">
  </picture>
</p>

# OpenSymbolicAI

> **WARNING: This project is highly experimental. APIs may change without notice.**

An AI-native programming framework where agents define primitive methods and LLMs generate execution plans.

## Concept

Traditional programming requires explicit step-by-step instructions. OpenSymbolicAI inverts this: you define *what* operations are possible (primitives), and the LLM figures out *how* to compose them to solve tasks.

```
User Task: "Calculate the hypotenuse of a right triangle with sides 3 and 4"
     ↓
LLM generates plan using your primitives:
     const a_squared = multiply(3, 3);
     const b_squared = multiply(4, 4);
     const sum = add(a_squared, b_squared);
     const hypotenuse = squareRoot(sum);
     ↓
Framework executes plan safely
     ↓
Result: 5
```

## Installation

```bash
npm install @opensymbolicai/core
```

## Universal Runtime — Browser + Node

`@opensymbolicai/core` is a single universal package that runs natively in both
Node.js and web browsers. There is no separate "web edition" — the same code
powers CLI apps, server-side agents, and browser-based agent UIs.

The package provides three entry points:

| Import path | Environment | Contents |
|---|---|---|
| `@opensymbolicai/core` | Browser + Node | Blueprints, interpreter, parser, LLM clients, in-memory stores |
| `@opensymbolicai/core/node` | Node only | `FileCheckpointStore`, `FileTransport` (uses `fs`) |
| `@opensymbolicai/core/browser` | Browser | `createBrowserLLM`, key providers, `IndexedDBCheckpointStore`, `LocalStorageCache`, `ProxyLLM` |

Bundlers (Vite, esbuild, webpack) will never pull in `fs/promises` or `path`
unless your code explicitly imports from `@opensymbolicai/core/node`.

### Requirements

- **Node**: 18+ (uses `globalThis.crypto` which is available from Node 18)
- **Browser**: Any modern browser (Chrome 63+, Firefox 57+, Safari 11+, Edge 79+)

---

## Quick Start — Node

```typescript
import 'reflect-metadata';
import { PlanExecute, primitive, decomposition, createLLM } from '@opensymbolicai/core';
import { FileCheckpointStore } from '@opensymbolicai/core/node';

class Calculator extends PlanExecute {
  @primitive({ readOnly: true })
  add(a: number, b: number): number {
    return a + b;
  }

  @primitive({ readOnly: true })
  multiply(a: number, b: number): number {
    return a * b;
  }

  // Teach the LLM by example
  @decomposition(
    'Calculate area of rectangle',
    'area = multiply(width, height)'
  )
  _exampleArea() {}
}

// API key loaded from OPENAI_API_KEY env var automatically
const llm = createLLM({ provider: 'openai', model: 'gpt-4', params: { temperature: 0 } });

const calc = new Calculator(llm, 'Calculator', 'A simple calculator');
const result = await calc.run('What is 2 + 3?');
console.log(result.result); // 5
```

## Quick Start — Browser

```typescript
import 'reflect-metadata';
import { GoalSeeking, InMemoryCheckpointStore } from '@opensymbolicai/core';
import { createBrowserLLM } from '@opensymbolicai/core/browser';

// Direct mode — browser calls the LLM provider API directly.
// API key comes from localStorage (set via LocalStorageKeyProvider).
const llm = createBrowserLLM({
  provider: 'openai',
  model: 'gpt-4',
  params: { temperature: 0 },
});

// Or proxy mode — calls route through your backend:
const llmProxy = createBrowserLLM(
  { provider: 'anthropic', model: 'claude-sonnet-4-6', params: {} },
  {
    proxyUrl: '/api/llm',           // your backend endpoint
    sessionToken: auth.getToken(),  // user's session token
  }
);
```

---

## Key Features

- **Primitive Methods**: Define operations the LLM can use via `@primitive` decorator
- **Decomposition Examples**: Teach patterns to the LLM via `@decomposition` decorator
- **Secure Execution**: Plans are parsed, validated, and executed in a sandboxed AST interpreter (no `eval()`)
- **Multiple Blueprints**: `PlanExecute`, `DesignExecute`, and `GoalSeeking` loop patterns
- **Multiple LLM Providers**: OpenAI, Anthropic, Ollama, Fireworks, Groq
- **Execution Traces**: Full structured observability via `Tracer` and span hierarchies
- **Checkpointing**: Save and restore execution state across runs
- **Universal**: Single package runs in browsers, Node.js, Deno, Bun, and Cloudflare Workers

---

## Blueprints

### PlanExecute

Single-shot planning: the LLM generates a plan from primitives, then the interpreter executes it.

```typescript
class MyAgent extends PlanExecute {
  @primitive({ readOnly: true })
  fetchData(url: string): Promise<string> { /* ... */ }
}
```

### DesignExecute

Two-phase: the LLM first *designs* a solution architecture, then generates and executes a plan that implements it.

```typescript
class Architect extends DesignExecute {
  @primitive()
  createModule(name: string, spec: string): Module { /* ... */ }
}
```

### GoalSeeking

Iterative loop: plan → execute → evaluate → update context → repeat, until a goal is met or max iterations reached.

```typescript
class Researcher extends GoalSeeking<ResearchContext> {
  @primitive({ readOnly: true })
  async searchWeb(query: string): Promise<string[]> { /* ... */ }

  protected async updateContext(goal: string, ctx: ResearchContext, result: OrchestrationResult) {
    // Introspection boundary — update context between iterations
  }
}
```

---

## LLM Providers

### Supported Providers

| Provider | Config | Env var (Node) | Browser direct |
|---|---|---|---|
| OpenAI | `{ provider: 'openai', model: 'gpt-4' }` | `OPENAI_API_KEY` | Yes (CORS supported) |
| Anthropic | `{ provider: 'anthropic', model: 'claude-sonnet-4-6' }` | `ANTHROPIC_API_KEY` | No (needs proxy) |
| Ollama | `{ provider: 'ollama', model: 'llama3' }` | — | Yes (localhost) |
| Fireworks | `{ provider: 'fireworks', model: '...' }` | `FIREWORKS_API_KEY` | Yes |
| Groq | `{ provider: 'groq', model: 'llama3-70b-8192' }` | `GROQ_API_KEY` | Yes |

### Node Usage

In Node, API keys are picked up from environment variables automatically:

```typescript
import { createLLM } from '@opensymbolicai/core';

// Reads OPENAI_API_KEY from process.env
const llm = createLLM({ provider: 'openai', model: 'gpt-4', params: {} });

// Or pass explicitly
const llm2 = createLLM({
  provider: 'openai',
  model: 'gpt-4',
  apiKey: 'sk-...',
  params: { temperature: 0 },
});
```

### Browser Usage

In the browser, there is no `process.env`. Use `createBrowserLLM` from `@opensymbolicai/core/browser`:

#### Direct Mode (user-managed keys in localStorage)

```typescript
import { createBrowserLLM, LocalStorageKeyProvider } from '@opensymbolicai/core/browser';

// Store a key (e.g., from a settings UI)
const keys = new LocalStorageKeyProvider();
keys.setKey('openai', 'sk-...');

// createBrowserLLM reads from localStorage by default
const llm = createBrowserLLM({
  provider: 'openai',
  model: 'gpt-4',
  params: { temperature: 0 },
});
```

Best for: personal tools, local development, single-user apps, demos.

#### Proxy Mode (server-managed keys)

```typescript
import { createBrowserLLM } from '@opensymbolicai/core/browser';

const llm = createBrowserLLM(
  { provider: 'anthropic', model: 'claude-sonnet-4-6', params: {} },
  {
    proxyUrl: '/api/llm',
    sessionToken: auth.getToken(),
  }
);
```

The browser sends requests to your backend, which attaches the real API key
and forwards to the LLM provider. The API key never reaches the browser.

Best for: team apps, managed environments, SaaS products, Anthropic (which
lacks CORS headers).

#### Using ProxyLLM Directly

```typescript
import { ProxyLLM } from '@opensymbolicai/core/browser';

const llm = new ProxyLLM(
  { provider: 'anthropic', model: 'claude-sonnet-4-6', params: {} },
  'https://your-proxy.example.com',
  sessionToken
);
```

### CORS Notes

Most LLM providers include CORS headers on their APIs, so browser apps can
call them directly. **Anthropic is the exception** — their API does not send
CORS headers, so browser-to-Anthropic calls will fail.

For Anthropic, use a lightweight CORS proxy. Example Cloudflare Worker:

```typescript
export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    url.hostname = 'api.anthropic.com';
    return fetch(new Request(url.toString(), request));
  }
};
```

---

## Persistence

### Checkpoint Stores

Checkpoint stores save and restore execution state, enabling pause/resume
and crash recovery for long-running agent loops.

| Store | Environment | Persistence |
|---|---|---|
| `InMemoryCheckpointStore` | Universal | In-process memory (lost on restart) |
| `FileCheckpointStore` | Node only | JSON files on disk |
| `IndexedDBCheckpointStore` | Browser only | IndexedDB (survives page refreshes) |

```typescript
// Universal
import { InMemoryCheckpointStore } from '@opensymbolicai/core';

// Node
import { FileCheckpointStore } from '@opensymbolicai/core/node';
const store = new FileCheckpointStore('./checkpoints');

// Browser
import { IndexedDBCheckpointStore } from '@opensymbolicai/core/browser';
const store = new IndexedDBCheckpointStore('my-app'); // database name
```

### LLM Response Caches

| Cache | Environment | Persistence |
|---|---|---|
| `InMemoryCache` | Universal | In-process LRU with optional TTL |
| `NullCache` | Universal | No-op (disables caching) |
| `LocalStorageCache` | Browser only | localStorage (survives page refreshes) |

```typescript
// Universal
import { InMemoryCache, createLLM } from '@opensymbolicai/core';
const llm = createLLM(config, new InMemoryCache(500));

// Browser
import { LocalStorageCache } from '@opensymbolicai/core/browser';
const cache = new LocalStorageCache('my_cache_', 200);
```

---

## Observability

The framework provides structured tracing via `Tracer` and `Span`, emitting
events to pluggable transports.

| Transport | Environment | Description |
|---|---|---|
| `InMemoryTransport` | Universal | Stores events in an array for inspection |
| `HttpTransport` | Universal | Batches and POSTs events to an HTTP endpoint |
| `FileTransport` | Node only | Appends JSONL to a file on disk |

```typescript
import { Tracer, InMemoryTransport, HttpTransport } from '@opensymbolicai/core';
import { FileTransport } from '@opensymbolicai/core/node';

const tracer = new Tracer({
  enabled: true,
  transports: [
    new InMemoryTransport(),
    new HttpTransport('https://telemetry.example.com/events'),
  ],
});
```

---

## Security Model

The interpreter executes LLM-generated plans safely in both Node and browser:

- **No `eval()`** — the interpreter walks the TypeScript AST node-by-node
- **No imports** — the AST validator rejects `import`/`require` statements
- **Blocked builtins** — `document`, `window`, `fetch`, `XMLHttpRequest`, `setTimeout`, `eval`, `Function` are in `DANGEROUS_BUILTINS`
- **Allowlisted builtins only** — `Math`, `JSON`, `Array`, `String`, `Number`, `console`, `parseInt`, `parseFloat`, etc.
- **Namespace isolation** — variables live in `ExecutionNamespace`, not on `globalThis`
- **Loop guards** — injected automatically to prevent infinite loops

### API Keys in the Browser

- **localStorage keys** (`LocalStorageKeyProvider`): accessible to any JS on the same origin — same trust boundary as the app itself. Never store keys in localStorage on shared/public computers.
- **Backend keys** (`BackendKeyProvider` + `ProxyLLM`): keys never leave the server. Recommended for multi-user or production apps.
- Direct-mode browser calls expose the API key in network requests (visible in DevTools, but not to other origins).

---

## Project Structure

```
src/
├── index.ts                 # Universal entry point (browser + Node)
├── node.ts                  # Node-only re-exports (FileCheckpointStore, FileTransport)
│
├── core.ts                  # @primitive, @decomposition, @evaluator decorators
├── models.ts                # Zod schemas + TypeScript types
├── exceptions.ts            # Error hierarchy
│
├── plan-execute.ts          # PlanExecute blueprint
├── design-execute.ts        # DesignExecute blueprint
├── goal-seeking.ts          # GoalSeeking blueprint
│
├── llm/                     # LLM provider implementations
│   ├── base.ts              # Abstract LLM class (uses fetch())
│   ├── cache.ts             # Cache key hashing (Web Crypto API)
│   ├── types.ts             # LLMConfig, LLMResponse, etc.
│   ├── openai.ts
│   ├── anthropic.ts
│   ├── groq.ts
│   ├── fireworks.ts
│   ├── ollama.ts
│   └── index.ts             # Factory + re-exports
│
├── parser/                  # TypeScript Compiler API-based
│   ├── ts-parser.ts         # Plan parsing
│   ├── ts-validator.ts      # Security validation
│   ├── loop-guard-rewriter.ts
│   └── index.ts
│
├── executor/                # Plan execution
│   ├── interpreter.ts       # AST-walking interpreter
│   ├── design-interpreter.ts
│   ├── namespace.ts         # Variable scope isolation
│   └── index.ts
│
├── checkpoint/              # Execution state persistence
│   ├── store.ts             # InMemoryCheckpointStore, FileCheckpointStore
│   ├── serializer.ts
│   └── index.ts
│
├── observability/           # Structured tracing
│   ├── tracer.ts            # Tracer + Span (Web Crypto for IDs)
│   ├── transports.ts        # InMemory, File, HTTP transports
│   └── index.ts
│
└── browser/                 # Browser-specific utilities
    ├── key-provider.ts      # KeyProvider interface + implementations
    ├── proxy-llm.ts         # ProxyLLM for backend-proxied calls
    ├── checkpoint-idb.ts    # IndexedDBCheckpointStore
    ├── cache-localstorage.ts # LocalStorageCache
    ├── create-browser-llm.ts # createBrowserLLM() factory
    └── index.ts             # Re-exports
```

## Bundle Size Notes

The `typescript` npm package (~5.2 MB, ~1.2 MB gzipped) is a runtime dependency
because the interpreter, parser, and validator use the TypeScript Compiler API
(`ts.createSourceFile`, `ts.SyntaxKind`, `ts.forEachChild`, etc.).

For browser apps, this means your bundle includes the TypeScript compiler. For an
agent runtime (not a marketing page), 1.2 MB gzipped is acceptable. The package
loads once when the first plan is parsed.

---

## Examples

See the [examples/](examples/) directory:

- [Calculator](examples/calculator.ts) - Basic arithmetic operations

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test

# Watch mode
npm run dev
```

## License

MIT
