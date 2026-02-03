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

## Quick Start

```typescript
import 'reflect-metadata';
import { PlanExecute, primitive, decomposition, LLMConfig } from '@opensymbolicai/core';

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

const calc = new Calculator(
  { provider: 'openai', model: 'gpt-4', params: { temperature: 0 } },
  'Calculator',
  'A simple calculator'
);

const result = await calc.run('What is 2 + 3?');
console.log(result.result); // 5
```

## Key Features

- **Primitive Methods**: Define operations the LLM can use via `@primitive` decorator
- **Decomposition Examples**: Teach patterns to the LLM via `@decomposition` decorator
- **Secure Execution**: Plans are parsed, validated, and executed in a sandboxed interpreter
- **Multiple LLM Providers**: OpenAI, Anthropic, Ollama, Fireworks, Groq
- **Execution Traces**: Full visibility into each step of plan execution
- **Checkpointing**: Save and restore execution state

## Supported LLM Providers

| Provider | Config |
|----------|--------|
| OpenAI | `{ provider: 'openai', model: 'gpt-4' }` |
| Anthropic | `{ provider: 'anthropic', model: 'claude-3-opus-20240229' }` |
| Ollama | `{ provider: 'ollama', model: 'llama2' }` |
| Fireworks | `{ provider: 'fireworks', model: 'accounts/fireworks/models/llama-v3-70b' }` |
| Groq | `{ provider: 'groq', model: 'llama3-70b-8192' }` |

## Project Structure

```
src/
├── core.ts           # @primitive and @decomposition decorators
├── plan-execute.ts   # Main PlanExecute base class
├── parser/           # Plan parsing and validation
│   ├── tokenizer.ts  # Lexical analysis
│   ├── parser.ts     # AST generation
│   └── validator.ts  # Security validation
├── executor/         # Plan execution
│   ├── interpreter.ts
│   └── namespace.ts
├── llm/              # LLM provider implementations
│   ├── openai.ts
│   ├── anthropic.ts
│   ├── ollama.ts
│   └── ...
├── checkpoint/       # State serialization
└── models.ts         # Zod schemas and types
```

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
