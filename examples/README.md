# OpenSymbolicAI Examples

Four example agents demonstrating each blueprint type.

## Examples

| Example | Blueprint | Description |
|---------|-----------|-------------|
| **Calculator** | `PlanExecute` | Scientific calculator with arithmetic, trig, logs, memory |
| **Shopping Cart** | `DesignExecute` | E-commerce cart with loops, discounts, state tax |
| **Recipe Nutrition** | `DesignExecute` | Nutrition calculator with structured types and aggregation |
| **Function Optimizer** | `GoalSeeking` | Iterative optimization to find a function's global maximum |

## Running

```bash
# Install dependencies and build
npm install && npm run build

# Run individual examples
npx tsx examples/calculator.ts
npx tsx examples/shopping-cart.ts
npx tsx examples/recipe-nutrition.ts
npx tsx examples/function-optimizer.ts

# Or use the main runner with provider selection
npx tsx examples/main.ts [example] [provider] [model] [-v]

# Examples:
npx tsx examples/main.ts calculator ollama qwen3:8b
npx tsx examples/main.ts cart openai gpt-4o
npx tsx examples/main.ts recipe anthropic claude-sonnet-4-6-20250514
npx tsx examples/main.ts optimizer groq openai/gpt-oss-120b -v
```

## Providers

Set the appropriate environment variable:

```bash
export OPENAI_API_KEY=...
export ANTHROPIC_API_KEY=...
export GROQ_API_KEY=...
export FIREWORKS_API_KEY=...
# Ollama: no key needed, just run ollama locally
```

## Running Tests

```bash
npx vitest run examples/calculator.test.ts
```
