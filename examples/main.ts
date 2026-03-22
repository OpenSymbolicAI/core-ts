/**
 * Main runner for OpenSymbolicAI examples.
 *
 * Usage:
 *   npx tsx examples/main.ts [example] [provider] [model] [-v]
 *
 * Examples: calculator, cart, recipe, optimizer
 * Providers: ollama, openai, anthropic, groq, fireworks
 */

import 'dotenv/config';
import 'reflect-metadata';
import { type LLMConfig, createLLM } from '../src/index.js';

const EXAMPLES = new Set(['calculator', 'optimizer', 'recipe', 'cart']);
const PROVIDERS = new Set(['ollama', 'openai', 'anthropic', 'groq', 'fireworks']);

const args = process.argv.slice(2);
const verbose = args.includes('-v') || args.includes('--verbose');
const positional = args.filter(a => !a.startsWith('-'));

const firstArg = positional[0] ?? '';

let exampleName: string;
let providerArgs: string[];

if (EXAMPLES.has(firstArg)) {
  exampleName = firstArg;
  providerArgs = positional.slice(1);
} else if (PROVIDERS.has(firstArg) || firstArg === '') {
  exampleName = 'calculator';
  providerArgs = positional;
} else {
  console.log(`Unknown example '${firstArg}'.`);
  console.log(`Available: ${[...EXAMPLES].sort().join(', ')}`);
  console.log('Usage: npx tsx examples/main.ts [example] [provider] [model] [-v]');
  process.exit(1);
}

const provider = (providerArgs[0] ?? 'ollama').toLowerCase() as LLMConfig['provider'];
const model = providerArgs[1] ?? {
  ollama: 'qwen3:8b',
  openai: 'gpt-4o',
  anthropic: 'claude-sonnet-4-6-20250514',
  groq: 'openai/gpt-oss-120b',

  fireworks: 'accounts/fireworks/models/llama-v3p3-70b-instruct',
}[provider] ?? 'qwen3:8b';

const apiKeyEnv: Record<string, string> = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  groq: 'GROQ_API_KEY',
  fireworks: 'FIREWORKS_API_KEY',
};

const config: LLMConfig = {
  provider,
  model,
  apiKey: apiKeyEnv[provider] ? process.env[apiKeyEnv[provider]] : undefined,
  params: { temperature: 0, maxTokens: 2000 },
};

const llm = createLLM(config);

console.log(`Provider: ${provider}, Model: ${model}`);
if (verbose) console.log('(Verbose mode enabled)');
console.log('');

switch (exampleName) {
  case 'calculator': {
    const { ScientificCalculator } = await import('./calculator.js');
    const calc = new ScientificCalculator(llm, 'ScientificCalculator',
      'A scientific calculator with arithmetic, trigonometry, logarithms, powers, and memory.');

    console.log(`Scientific Calculator (${provider} - ${model})`);
    console.log('='.repeat(50));
    console.log('Primitives:', calc.getPrimitiveNames().join(', '));
    console.log('Type your math questions or "quit" to exit.\n');

    const readline = await import('readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    const ask = () => {
      rl.question('>>> ', async (query) => {
        if (!query || query.trim() === '') { ask(); return; }
        if (['quit', 'exit', 'q'].includes(query.trim().toLowerCase())) {
          console.log('Goodbye!');
          rl.close();
          return;
        }
        try {
          const result = await calc.run(query.trim());
          if (verbose && result.trace) {
            for (const step of result.trace.steps) {
              const status = step.success ? 'OK' : 'FAIL';
              console.log(`  [${status}] ${step.statement} => ${step.resultValue}`);
            }
          }
          if (result.success) {
            console.log(`= ${result.result}`);
          } else {
            console.log(`Error: ${result.error}`);
          }
        } catch (e) {
          console.log(`Exception: ${e instanceof Error ? e.message : String(e)}`);
        }
        console.log('');
        ask();
      });
    };
    ask();
    break;
  }

  case 'cart': {
    const { ShoppingCartAgent, CATALOG, BULK_DISCOUNT_PERCENT, BULK_THRESHOLD } = await import('./shopping-cart.js');
    const agent = new ShoppingCartAgent(llm, { maxPlanRetries: 2 });

    console.log(`Shopping Cart (${provider} - ${model})`);
    console.log('='.repeat(55));
    console.log('Available items:');
    for (const [item, price] of Object.entries(CATALOG).sort()) {
      console.log(`  ${item.padEnd(15)} $${price.toFixed(2)}`);
    }
    console.log(`\nBulk discount: ${BULK_DISCOUNT_PERCENT}% off when buying ${BULK_THRESHOLD}+\n`);

    const tasks = [
      "What's the total for 5 apples and 1 laptop, shipping to CA?",
      'I want 2 headphones, 3 books, and 10 pens. Shipping to OR.',
      'Calculate the total for 1 coffee, 1 mouse, and 1 notebook for TX.',
      "I'd like 2 dragon fruits shipped to CA.",
      'Just give me 3 bananas.',
    ];

    for (const task of tasks) {
      console.log(`Task: ${task}`);
      try {
        const result = await agent.run(task);
        if (result.success) console.log(`Total: $${(result.result as number).toFixed(2)}`);
        else console.log(`Error: ${result.error}`);
      } catch (e) {
        console.log(`Error: ${e instanceof Error ? e.message : String(e)}`);
      }
      console.log('');
    }
    break;
  }

  case 'recipe': {
    const { RecipeNutrition, NUTRITION_DB } = await import('./recipe-nutrition.js');
    const agent = new RecipeNutrition(llm, { maxPlanRetries: 2 });

    console.log(`Recipe Nutrition (${provider} - ${model})`);
    console.log('='.repeat(55));
    console.log('Available ingredients (per 100g):');
    for (const [name, info] of Object.entries(NUTRITION_DB).sort()) {
      console.log(`  ${name.padEnd(16)} ${String(info.calories).padStart(6)} cal  ${info.proteinG.toFixed(1).padStart(5)}g prot  ${info.carbsG.toFixed(1).padStart(5)}g carbs`);
    }
    console.log('');

    const tasks = [
      'What is the nutrition for a meal with 200g chicken breast, 150g rice, and 100g broccoli? It serves 2.',
      'How many calories and protein in 250g of salmon?',
      "What's the nutrition in 100g of dragon fruit?",
    ];

    for (const task of tasks) {
      console.log(`Task: ${task}`);
      try {
        const result = await agent.run(task);
        if (result.success) console.log(`Result: ${JSON.stringify(result.result, null, 2)}`);
        else console.log(`Error: ${result.error}`);
      } catch (e) {
        console.log(`Error: ${e instanceof Error ? e.message : String(e)}`);
      }
      console.log('');
    }
    break;
  }

  case 'optimizer': {
    const { FunctionOptimizer } = await import('./function-optimizer.js');
    const optimizer = new FunctionOptimizer(llm, 0.01, 25);

    console.log(`Function Optimizer (${provider} - ${model})`);
    console.log('='.repeat(60));
    console.log('Goal: Find the global maximum of f(x) on [0, 20]');
    console.log(`True maximum: f(${optimizer.trueMax.x.toFixed(4)}) = ${optimizer.trueMax.value.toFixed(6)}`);
    console.log('\nIterating...');

    const result = await optimizer.seek('Find the x in [0, 20] that maximizes the function f(x)');

    for (const iter of result.iterations) {
      const steps = iter.executionResult?.trace?.steps ?? [];
      const evalSteps = steps
        .filter(s => s.primitiveCalled === 'evaluate' && s.success)
        .map(s => `f(${s.args?.['arg0']?.expression})=${s.resultValue}`);
      console.log(`  #${iter.iterationNumber}: ${evalSteps.join(', ')}`);
    }

    console.log('');
    if (result.achieved) console.log('Converged!');
    else console.log('Did not converge within iteration limit.');
    console.log(`Iterations used: ${result.iterations.length}`);
    break;
  }
}
