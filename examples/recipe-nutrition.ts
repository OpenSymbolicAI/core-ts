/**
 * Recipe Nutrition Example - DesignExecute Blueprint
 *
 * An agent that calculates nutritional content for recipes.
 * Demonstrates DesignExecute with complex structured types:
 * primitives that accept and return domain objects, loops over
 * ingredient lists, and aggregation of nested fields.
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

// ============================================================
// Domain Models
// ============================================================

interface NutritionInfo {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number;
}

interface Ingredient {
  name: string;
  grams: number;
  nutrition: NutritionInfo;
}

interface MealSummary {
  mealName: string;
  ingredients: Ingredient[];
  totalNutrition: NutritionInfo;
  servings: number;
  perServing: NutritionInfo;
}

function zeroNutrition(): NutritionInfo {
  return { calories: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0 };
}

function addNutrition(a: NutritionInfo, b: NutritionInfo): NutritionInfo {
  return {
    calories: Math.round((a.calories + b.calories) * 10) / 10,
    proteinG: Math.round((a.proteinG + b.proteinG) * 10) / 10,
    carbsG: Math.round((a.carbsG + b.carbsG) * 10) / 10,
    fatG: Math.round((a.fatG + b.fatG) * 10) / 10,
    fiberG: Math.round((a.fiberG + b.fiberG) * 10) / 10,
  };
}

function divideNutrition(n: NutritionInfo, servings: number): NutritionInfo {
  if (servings <= 0) throw new Error('Servings must be positive');
  return {
    calories: Math.round((n.calories / servings) * 10) / 10,
    proteinG: Math.round((n.proteinG / servings) * 10) / 10,
    carbsG: Math.round((n.carbsG / servings) * 10) / 10,
    fatG: Math.round((n.fatG / servings) * 10) / 10,
    fiberG: Math.round((n.fiberG / servings) * 10) / 10,
  };
}

function scaleNutrition(base: NutritionInfo, grams: number): NutritionInfo {
  const factor = grams / 100.0;
  return {
    calories: Math.round(base.calories * factor * 10) / 10,
    proteinG: Math.round(base.proteinG * factor * 10) / 10,
    carbsG: Math.round(base.carbsG * factor * 10) / 10,
    fatG: Math.round(base.fatG * factor * 10) / 10,
    fiberG: Math.round(base.fiberG * factor * 10) / 10,
  };
}

function formatNutrition(n: NutritionInfo): string {
  return `${n.calories} cal | ${n.proteinG}g protein | ${n.carbsG}g carbs | ${n.fatG}g fat | ${n.fiberG}g fiber`;
}

// Nutrition database: values per 100g
const NUTRITION_DB: Record<string, NutritionInfo> = {
  'chicken breast': { calories: 165, proteinG: 31.0, carbsG: 0.0, fatG: 3.6, fiberG: 0.0 },
  rice:             { calories: 130, proteinG: 2.7, carbsG: 28.2, fatG: 0.3, fiberG: 0.4 },
  broccoli:         { calories: 34, proteinG: 2.8, carbsG: 7.0, fatG: 0.4, fiberG: 2.6 },
  salmon:           { calories: 208, proteinG: 20.4, carbsG: 0.0, fatG: 13.4, fiberG: 0.0 },
  egg:              { calories: 155, proteinG: 13.0, carbsG: 1.1, fatG: 11.0, fiberG: 0.0 },
  pasta:            { calories: 131, proteinG: 5.0, carbsG: 25.0, fatG: 1.1, fiberG: 1.8 },
  spinach:          { calories: 23, proteinG: 2.9, carbsG: 3.6, fatG: 0.4, fiberG: 2.2 },
  'olive oil':      { calories: 884, proteinG: 0.0, carbsG: 0.0, fatG: 100.0, fiberG: 0.0 },
  tomato:           { calories: 18, proteinG: 0.9, carbsG: 3.9, fatG: 0.2, fiberG: 1.2 },
  cheese:           { calories: 402, proteinG: 25.0, carbsG: 1.3, fatG: 33.1, fiberG: 0.0 },
  potato:           { calories: 77, proteinG: 2.0, carbsG: 17.5, fatG: 0.1, fiberG: 2.2 },
  banana:           { calories: 89, proteinG: 1.1, carbsG: 22.8, fatG: 0.3, fiberG: 2.6 },
  oats:             { calories: 389, proteinG: 16.9, carbsG: 66.3, fatG: 6.9, fiberG: 10.6 },
  avocado:          { calories: 160, proteinG: 2.0, carbsG: 8.5, fatG: 14.7, fiberG: 6.7 },
  lentils:          { calories: 116, proteinG: 9.0, carbsG: 20.1, fatG: 0.4, fiberG: 7.9 },
};

// ============================================================
// RecipeNutrition Agent
// ============================================================

class RecipeNutrition extends DesignExecute {
  constructor(
    llm: import('../src/llm/index.js').LLM | LLMConfig,
    config?: DesignExecuteConfig,
    cache?: LLMCache
  ) {
    super(llm, 'RecipeNutrition', 'Calculates nutritional content for recipes', config, cache);
  }

  @primitive({ readOnly: true, docstring: 'Look up nutrition for an ingredient at a given weight in grams' })
  getNutrition(ingredient: string, grams: number): NutritionInfo {
    const key = ingredient.trim().toLowerCase();
    if (!(key in NUTRITION_DB)) {
      const available = Object.keys(NUTRITION_DB).sort().join(', ');
      throw new Error(`Unknown ingredient '${ingredient}'. Available: ${available}`);
    }
    return scaleNutrition(NUTRITION_DB[key], grams);
  }

  @primitive({ readOnly: true, docstring: 'Create an Ingredient object' })
  makeIngredient(name: string, grams: number, nutrition: NutritionInfo): Ingredient {
    return { name, grams, nutrition };
  }

  @primitive({ readOnly: true, docstring: 'Return a zero-valued NutritionInfo' })
  zeroNutrition(): NutritionInfo {
    return zeroNutrition();
  }

  @primitive({ readOnly: true, docstring: 'Add two NutritionInfo objects together' })
  addNutrition(a: NutritionInfo, b: NutritionInfo): NutritionInfo {
    return addNutrition(a, b);
  }

  @primitive({ readOnly: true, docstring: 'Divide nutrition by number of servings' })
  divideNutrition(nutrition: NutritionInfo, servings: number): NutritionInfo {
    return divideNutrition(nutrition, servings);
  }

  @primitive({ readOnly: true, docstring: 'Build a complete MealSummary' })
  buildMealSummary(
    mealName: string,
    ingredients: Ingredient[],
    totalNutrition: NutritionInfo,
    servings: number,
    perServing: NutritionInfo
  ): MealSummary {
    return { mealName, ingredients, totalNutrition, servings, perServing };
  }

  // ---- Decompositions ----

  @decomposition(
    'What is the nutrition for a chicken and rice bowl with 200g chicken breast, 150g rice, and 100g broccoli? Serves 2.',
    `// Loop over ingredients, look up nutrition, accumulate, divide by servings
const items = [["chicken breast", 200], ["rice", 150], ["broccoli", 100]]
let total = zeroNutrition()
const ingredientList = []
for (const [name, grams] of items) {
  const info = getNutrition(name, grams)
  const ing = makeIngredient(name, grams, info)
  ingredientList.push(ing)
  total = addNutrition(total, info)
}
const perServing = divideNutrition(total, 2)
const meal = buildMealSummary("Chicken and Rice Bowl", ingredientList, total, 2, perServing)`,
    'Loop over each (ingredient, grams), look up nutrition, build Ingredient objects, accumulate total, divide by servings, build MealSummary.'
  )
  _exampleChickenRice() {}

  @decomposition(
    'How many calories in 100g of salmon?',
    'const result = getNutrition("salmon", 100)',
    'Look up nutrition for a single ingredient and return the full NutritionInfo.'
  )
  _exampleSingleLookup() {}

  @decomposition(
    'Compare the calories in 100g of rice vs 100g of pasta',
    `const rice = getNutrition("rice", 100)
const pasta = getNutrition("pasta", 100)`,
    'Look up nutrition for each ingredient separately.'
  )
  _exampleCompare() {}

  @decomposition(
    "What's the nutrition in 100g of dragon fruit?",
    'const result = getNutrition("dragon fruit", 100)',
    "The ingredient 'dragon fruit' is not in the database. getNutrition will throw."
  )
  _exampleUnknownIngredient() {}
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

  const agent = new RecipeNutrition(config, { maxPlanRetries: 2 });

  console.log('Recipe Nutrition Agent');
  console.log('=====================\n');

  console.log('Available ingredients (per 100g):');
  for (const [name, info] of Object.entries(NUTRITION_DB).sort()) {
    console.log(`  ${name.padEnd(16)} ${String(info.calories).padStart(6)} cal  ${info.proteinG.toFixed(1).padStart(5)}g protein  ${info.carbsG.toFixed(1).padStart(5)}g carbs  ${info.fatG.toFixed(1).padStart(5)}g fat`);
  }
  console.log('');

  const tasks = [
    'What is the nutrition for a meal with 200g chicken breast, 150g rice, and 100g broccoli? It serves 2.',
    'How many calories and protein in 250g of salmon?',
    'Calculate nutrition for pasta with cheese: 200g pasta, 50g cheese, 15g olive oil, 100g tomato. Serves 3.',
    "What's the nutrition in 100g of dragon fruit?", // error case
  ];

  for (const task of tasks) {
    console.log(`Task: ${task}`);
    try {
      const result = await agent.run(task);
      if (result.success) {
        const val = result.result;
        if (val && typeof val === 'object' && 'mealName' in (val as MealSummary)) {
          const meal = val as MealSummary;
          console.log(`Meal: ${meal.mealName}`);
          console.log(`  Ingredients: ${meal.ingredients.map(i => `${i.name} (${i.grams}g)`).join(', ')}`);
          console.log(`  Total:       ${formatNutrition(meal.totalNutrition)}`);
          console.log(`  Per serving: ${formatNutrition(meal.perServing)} (${meal.servings} servings)`);
        } else if (val && typeof val === 'object' && 'calories' in (val as NutritionInfo)) {
          console.log(`Nutrition: ${formatNutrition(val as NutritionInfo)}`);
        } else {
          console.log(`Result: ${JSON.stringify(val)}`);
        }
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

export { RecipeNutrition, NUTRITION_DB, type NutritionInfo, type Ingredient, type MealSummary };
