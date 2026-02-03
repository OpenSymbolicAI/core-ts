# Calculator Example

A simple calculator agent demonstrating the OpenSymbolicAI framework.

## Overview

This example shows how to:

1. Create a `PlanExecute` subclass
2. Define `@primitive` methods that the LLM can call
3. Provide `@decomposition` examples to teach the LLM patterns
4. Run the agent with natural language tasks

## Available Operations

### Primitives

| Method | Description |
|--------|-------------|
| `add(a, b)` | Add two numbers |
| `subtract(a, b)` | Subtract two numbers |
| `multiply(a, b)` | Multiply two numbers |
| `divide(a, b)` | Divide two numbers |
| `squareRoot(n)` | Calculate square root |
| `power(base, exp)` | Raise to a power |
| `absoluteValue(n)` | Get absolute value |
| `roundTo(n, decimals)` | Round to decimal places |
| `formatNumber(value, options)` | Format number as string |
| `memoryStore(value)` | Store value in memory |
| `memoryRecall()` | Recall value from memory |
| `memoryClear()` | Clear memory |
| `memoryAdd(value)` | Add to memory |

### Decomposition Examples

The agent includes examples for:

- Circle area calculation
- Hypotenuse (Pythagorean theorem)
- Compound interest
- Percentage calculations

## Running the Example

### Prerequisites

```bash
# Install dependencies
npm install

# Build the project
npm run build
```

### Configure LLM Provider

Set the appropriate environment variable for your LLM provider:

```bash
# For OpenAI
export OPENAI_API_KEY=your-key

# For Anthropic
export ANTHROPIC_API_KEY=your-key

# For Ollama (local)
# No API key needed, just run Ollama locally
```

### Modify the Config (Optional)

Edit `calculator.ts` to change the LLM provider:

```typescript
const config: LLMConfig = {
  provider: 'openai',  // or 'anthropic', 'ollama', etc.
  model: 'gpt-4',
  params: {
    temperature: 0,
    maxTokens: 1000,
  },
};
```

### Run

```bash
npx tsx examples/calculator.ts
```

## Example Output

```
Task: What is 2 + 3?
--------------------------------------------------
Result: 5
Plan:
const sum = add(2, 3);

Execution trace (1 steps):
  1. const sum = add(2, 3)
     → 5 (number)

Task: Calculate the area of a circle with radius 5
--------------------------------------------------
Result: 78.53975
Plan:
const radius = 5;
const radius_squared = multiply(radius, radius);
const area = multiply(radius_squared, 3.14159);

Execution trace (3 steps):
  1. const radius = 5
     → 5 (number)
  2. const radius_squared = multiply(radius, radius)
     → 25 (number)
  3. const area = multiply(radius_squared, 3.14159)
     → 78.53975 (number)
```

## How It Works

1. You provide a natural language task (e.g., "Calculate the area of a circle with radius 5")
2. The LLM generates a plan using only the defined primitives
3. The plan is parsed and validated for security
4. Each step is executed, with results available for subsequent steps
5. The final result is returned along with an execution trace
