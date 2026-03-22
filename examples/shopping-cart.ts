/**
 * Shopping Cart Example - DesignExecute Blueprint
 *
 * An e-commerce cart agent that computes totals with discounts and state tax.
 * Demonstrates DesignExecute's control flow capabilities: loops over cart items,
 * conditional bulk discounts, and state-specific tax rates.
 */

import 'dotenv/config';
import 'reflect-metadata';

import {
  DesignExecute,
  primitive,
  decomposition,
  type LLMConfig,
  type DesignExecuteConfig,
  type LLMCache,
} from '../src/index.js';

const CATALOG: Record<string, number> = {
  // Fruits & snacks
  apple: 1.50, banana: 0.75, orange: 1.25,
  grapes: 3.99, 'granola bar': 2.49, chips: 4.29,
  // Drinks
  coffee: 8.99, tea: 5.49, 'water bottle': 1.99, juice: 3.49,
  // Office supplies
  pen: 2.49, pencil: 1.29, notebook: 4.99,
  stapler: 7.99, 'sticky notes': 3.49, folder: 2.99,
  // Electronics
  laptop: 999.99, mouse: 29.99, keyboard: 49.99,
  headphones: 79.99, 'usb cable': 9.99, charger: 24.99,
  monitor: 349.99, webcam: 59.99,
  // Books & media
  book: 12.99, magazine: 6.99, ebook: 9.99,
};

const STATE_TAX_RATES: Record<string, number> = {
  AL: 4.0, AK: 0.0, AZ: 5.6, AR: 6.5,
  CA: 7.25, CO: 2.9, CT: 6.35, DE: 0.0,
  FL: 6.0, GA: 4.0, HI: 4.0, ID: 6.0,
  IL: 6.25, IN: 7.0, IA: 6.0, KS: 6.5,
  KY: 6.0, LA: 4.45, ME: 5.5, MD: 6.0,
  MA: 6.25, MI: 6.0, MN: 6.875, MS: 7.0,
  MO: 4.225, MT: 0.0, NE: 5.5, NV: 6.85,
  NH: 0.0, NJ: 6.625, NM: 5.0, NY: 4.0,
  NC: 4.75, ND: 5.0, OH: 5.75, OK: 4.5,
  OR: 0.0, PA: 6.0, RI: 7.0, SC: 6.0,
  SD: 4.2, TN: 7.0, TX: 6.25, UT: 6.1,
  VT: 6.0, VA: 5.3, WA: 6.5, WV: 6.0,
  WI: 5.0, WY: 4.0,
};

const BULK_THRESHOLD = 3;
const BULK_DISCOUNT_PERCENT = 10.0;

class ShoppingCartAgent extends DesignExecute {
  constructor(
    llm: import('../src/llm/index.js').LLM | LLMConfig,
    config?: DesignExecuteConfig,
    cache?: LLMCache
  ) {
    super(llm, 'ShoppingCart', 'E-commerce cart with discounts and state tax', config, cache);
  }

  @primitive({ readOnly: true, deterministic: false, docstring: 'Resolve a user-typed item name to a catalog key using LLM fuzzy matching' })
  async resolveItem(name: string): Promise<string> {
    const canonical = name.trim().toLowerCase();
    if (canonical in CATALOG) return canonical;

    const catalogItems = Object.keys(CATALOG).sort().join(', ');
    const prompt = `The catalog contains these items: ${catalogItems}\n\n`
      + `Which catalog item best matches "${name}"?\n`
      + 'Reply with ONLY the exact catalog item name, nothing else.';

    const response = await this.llm.generate(prompt);
    const resolved = response.text.trim().replace(/['"]/g, '').toLowerCase();

    if (!(resolved in CATALOG)) {
      throw new Error(`Could not resolve '${name}' to a catalog item. LLM suggested '${resolved}'. Available: ${catalogItems}`);
    }
    return resolved;
  }

  @primitive({ readOnly: true, docstring: 'Look up the price of a catalog item' })
  lookupPrice(item: string): number {
    const key = item.trim().toLowerCase();
    if (!(key in CATALOG)) {
      throw new Error(`Item '${item}' not found in catalog. Available: ${Object.keys(CATALOG).sort().join(', ')}`);
    }
    return CATALOG[key];
  }

  @primitive({ readOnly: true, docstring: 'Look up the sales tax rate for a US state' })
  lookupTaxRate(state: string): number {
    const code = state.trim().toUpperCase();
    if (!(code in STATE_TAX_RATES)) {
      throw new Error(`Unknown state '${state}'. Use a two-letter state code (e.g., CA, NY, TX).`);
    }
    return STATE_TAX_RATES[code];
  }

  @primitive({ readOnly: true, docstring: 'Multiply price by quantity' })
  multiply(price: number, quantity: number): number {
    return Math.round(price * quantity * 100) / 100;
  }

  @primitive({ readOnly: true, docstring: 'Apply a percentage discount' })
  applyDiscount(price: number, percent: number): number {
    return Math.round(price * (1 - percent / 100) * 100) / 100;
  }

  @primitive({ readOnly: true, docstring: 'Add two amounts' })
  add(a: number, b: number): number {
    return Math.round((a + b) * 100) / 100;
  }

  @primitive({ readOnly: true, docstring: 'Add sales tax to a subtotal' })
  addTax(subtotal: number, rate: number): number {
    return Math.round(subtotal * (1 + rate / 100) * 100) / 100;
  }

  // ---- Decompositions ----

  @decomposition(
    'I need 5 apples and 1 laptop shipped to California',
    `// Loop over cart items, resolve names, look up prices, apply bulk discounts, add tax
const items = [["apples", 5], ["laptop", 1]]
let subtotal = 0
for (const [rawName, qty] of items) {
  const item = resolveItem(rawName)
  const price = lookupPrice(item)
  let line = multiply(price, qty)
  if (qty >= 3) {
    line = applyDiscount(line, 10)
  }
  subtotal = add(subtotal, line)
}
const taxRate = lookupTaxRate("CA")
const total = addTax(subtotal, taxRate)`,
    'Loop over each (item, qty), resolve name, look up price, compute line total, apply 10% discount if qty >= 3, accumulate subtotal, then add state tax.'
  )
  _exampleCartWithStateTax() {}

  @decomposition(
    "I'd like to buy 3 bananas",
    'const error = "No shipping state specified. Please provide a US state code (e.g., CA, NY, TX)."',
    'The user did NOT provide a US state for shipping. Do NOT invent or assume a state. Return an error message as the result.'
  )
  _exampleMissingState() {}

  @decomposition(
    'I want 2 dragon fruits shipped to CA',
    `const item = resolveItem("dragon fruit")
const price = lookupPrice(item)
const line = multiply(price, 1)
const taxRate = lookupTaxRate("CA")
const total = addTax(line, taxRate)`,
    "The item 'dragon fruit' is not in the catalog. resolveItem will throw."
  )
  _exampleUnknownItem() {}
}

// ============================================================
// Main
// ============================================================

async function main() {
  const config: LLMConfig = {
    provider: 'groq',
    model: 'openai/gpt-oss-120b',
    apiKey: process.env.GROQ_API_KEY,
    params: { temperature: 0, maxTokens: 2000 },
  };

  const agent = new ShoppingCartAgent(config, { maxPlanRetries: 2 });

  console.log('Shopping Cart Agent');
  console.log('===================\n');

  console.log('Available items:');
  for (const [item, price] of Object.entries(CATALOG).sort()) {
    console.log(`  ${item.padEnd(15)} $${price.toFixed(2)}`);
  }
  console.log(`\nBulk discount: ${BULK_DISCOUNT_PERCENT}% off when buying ${BULK_THRESHOLD}+ of the same item`);
  console.log('');

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
      if (result.success) {
        const val = result.result;
        if (typeof val === 'number') console.log(`Total: $${val.toFixed(2)}`);
        else console.log(`Result: ${val}`);
      } else {
        console.log(`Error: ${result.error}`);
      }
    } catch (e) {
      console.log(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
    console.log('');
  }
}

main().catch(console.error);

export { ShoppingCartAgent, CATALOG, STATE_TAX_RATES, BULK_THRESHOLD, BULK_DISCOUNT_PERCENT };
