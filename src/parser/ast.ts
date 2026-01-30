/**
 * AST node types for the plan parser.
 *
 * The AST is designed to represent a restricted subset of Python:
 * - Only assignment statements
 * - Only primitive calls, literals, and variable references
 * - No control flow, imports, or function definitions
 */

/**
 * Literal values that can appear in expressions.
 */
export type NumberLiteral = {
  type: 'number';
  value: number;
};

export type StringLiteral = {
  type: 'string';
  value: string;
};

export type BooleanLiteral = {
  type: 'boolean';
  value: boolean;
};

export type NullLiteral = {
  type: 'null';
};

export type Literal = NumberLiteral | StringLiteral | BooleanLiteral | NullLiteral;

/**
 * Reference to a variable.
 */
export type Identifier = {
  type: 'identifier';
  name: string;
};

/**
 * List literal: [a, b, c]
 */
export type ListExpression = {
  type: 'list';
  elements: Expression[];
};

/**
 * Dict literal: {a: b, c: d}
 */
export type DictExpression = {
  type: 'dict';
  entries: Array<{ key: Expression; value: Expression }>;
};

/**
 * Attribute access: obj.attr
 */
export type AttributeAccess = {
  type: 'attribute';
  object: Expression;
  attribute: string;
};

/**
 * Function/method call with positional and keyword arguments.
 */
export type CallExpression = {
  type: 'call';
  callee: string;
  args: Expression[];
  kwargs: Record<string, Expression>;
};

/**
 * All possible expressions.
 */
export type Expression =
  | Literal
  | Identifier
  | ListExpression
  | DictExpression
  | AttributeAccess
  | CallExpression;

/**
 * Assignment statement: variable = expression
 * or: variable: Type = expression
 */
export interface Assignment {
  type: 'assignment';
  variable: string;
  typeAnnotation?: string;
  value: Expression;
  line: number;
}

/**
 * A statement in the plan (currently only assignments).
 */
export type Statement = Assignment;

/**
 * A complete plan consisting of statements.
 */
export interface Plan {
  statements: Statement[];
  source: string;
}

/**
 * Check if an expression is a literal.
 */
export function isLiteral(expr: Expression): expr is Literal {
  return (
    expr.type === 'number' ||
    expr.type === 'string' ||
    expr.type === 'boolean' ||
    expr.type === 'null'
  );
}

/**
 * Check if an expression is a function call.
 */
export function isCall(expr: Expression): expr is CallExpression {
  return expr.type === 'call';
}

/**
 * Check if an expression is an identifier (variable reference).
 */
export function isIdentifier(expr: Expression): expr is Identifier {
  return expr.type === 'identifier';
}

/**
 * Get the string representation of an expression for display.
 */
export function expressionToString(expr: Expression): string {
  switch (expr.type) {
    case 'number':
      return String(expr.value);
    case 'string':
      return JSON.stringify(expr.value);
    case 'boolean':
      return expr.value ? 'True' : 'False';
    case 'null':
      return 'None';
    case 'identifier':
      return expr.name;
    case 'list':
      return `[${expr.elements.map(expressionToString).join(', ')}]`;
    case 'dict': {
      const entries = expr.entries.map(
        (e) => `${expressionToString(e.key)}: ${expressionToString(e.value)}`
      );
      return `{${entries.join(', ')}}`;
    }
    case 'attribute':
      return `${expressionToString(expr.object)}.${expr.attribute}`;
    case 'call': {
      const args = expr.args.map(expressionToString);
      const kwargs = Object.entries(expr.kwargs).map(
        ([k, v]) => `${k}=${expressionToString(v)}`
      );
      return `${expr.callee}(${[...args, ...kwargs].join(', ')})`;
    }
  }
}

/**
 * Get the string representation of a statement.
 */
export function statementToString(stmt: Statement): string {
  const typeAnn = stmt.typeAnnotation ? `: ${stmt.typeAnnotation}` : '';
  return `${stmt.variable}${typeAnn} = ${expressionToString(stmt.value)}`;
}
