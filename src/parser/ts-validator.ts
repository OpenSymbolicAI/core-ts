/**
 * TypeScript AST-based plan validator.
 *
 * Uses ts.forEachChild visitor pattern (like Roslyn's SyntaxWalker)
 * to enforce a default-deny allowlist model. Only explicitly allowed
 * constructs, primitives, and builtins are permitted.
 */

import ts from 'typescript';
import { PlanValidationError } from '../exceptions.js';
import { resolveCalleeName, getNodeLine } from './ts-parser.js';

export interface ValidationResult {
  valid: boolean;
  errors: PlanValidationIssue[];
}

export interface PlanValidationIssue {
  message: string;
  line: number;
  node?: ts.Node;
}

export interface ValidationOptions {
  primitiveNames: Set<string>;
  allowedBuiltins: Set<string>;
  allowSelfCalls?: boolean;
  allowControlFlow?: boolean;
  allowBreakContinue?: boolean;
}

/**
 * Dangerous builtins/globals that should never be allowed.
 */
export const DANGEROUS_BUILTINS = new Set([
  'eval', 'Function',
  'setTimeout', 'setInterval', 'setImmediate',
  'require', 'import', 'process', '__dirname', '__filename',
  'document', 'window', 'location', 'XMLHttpRequest', 'fetch',
  'Reflect', 'Proxy',
  'constructor', '__proto__', 'prototype',
  'globalThis',
]);

/**
 * Default safe builtins available in plans.
 */
export const DEFAULT_ALLOWED_BUILTINS = new Set([
  'length', 'map', 'filter', 'reduce', 'find', 'findIndex',
  'some', 'every', 'includes', 'indexOf', 'slice', 'concat',
  'join', 'reverse', 'sort',
  'Number', 'String', 'Boolean', 'Array', 'Object',
  'Math', 'abs', 'min', 'max', 'round', 'floor', 'ceil', 'pow', 'sqrt',
  'keys', 'values', 'entries',
  'console', 'JSON', 'parseInt', 'parseFloat', 'isNaN', 'isFinite',
  // Python-style builtins from executor namespace
  'len', 'range', 'enumerate', 'zip', 'int', 'float', 'str', 'bool',
  'list', 'dict', 'set', 'tuple', 'sum', 'sorted', 'reversed',
  'any', 'all', 'print', 'repr', 'ord', 'chr',
]);

/**
 * Dangerous types that cannot be constructed or referenced.
 */
const DANGEROUS_TYPES = new Set([
  'File', 'Directory', 'Process', 'Assembly', 'Thread',
  'Console', 'GC', 'Unsafe', 'WebClient', 'Socket',
  'Worker', 'SharedArrayBuffer', 'Atomics',
]);

/**
 * Safe instance methods that are always allowed on values.
 */
const SAFE_INSTANCE_METHODS = new Set([
  'toString', 'valueOf', 'toFixed', 'toPrecision', 'toExponential',
  'trim', 'trimStart', 'trimEnd', 'toLowerCase', 'toUpperCase',
  'startsWith', 'endsWith', 'split', 'replace', 'replaceAll',
  'substring', 'charAt', 'charCodeAt', 'padStart', 'padEnd',
  'match', 'search', 'repeat',
  'push', 'pop', 'shift', 'unshift', 'splice',
  'map', 'filter', 'reduce', 'reduceRight', 'find', 'findIndex',
  'some', 'every', 'includes', 'indexOf', 'lastIndexOf',
  'forEach', 'flat', 'flatMap', 'fill', 'copyWithin',
  'slice', 'concat', 'join', 'reverse', 'sort',
  'keys', 'values', 'entries', 'has', 'get', 'set', 'delete', 'clear', 'add',
  'size', 'length',
]);

/**
 * Validate a plan AST against allowed primitives and builtins.
 */
export function validatePlan(
  sourceFile: ts.SourceFile,
  options: ValidationOptions
): ValidationResult {
  const errors: PlanValidationIssue[] = [];
  const validator = new PlanAstValidator(sourceFile, options, errors);
  validator.validate();
  return { valid: errors.length === 0, errors };
}

/**
 * Validate a plan and throw if invalid.
 */
export function validatePlanOrThrow(
  sourceFile: ts.SourceFile,
  options: ValidationOptions
): void {
  const result = validatePlan(sourceFile, options);
  if (!result.valid) {
    const messages = result.errors.map((e) => `Line ${e.line}: ${e.message}`);
    throw new PlanValidationError(
      `Invalid plan: ${messages.join('; ')}`,
      sourceFile.getText(),
      messages
    );
  }
}

/**
 * AST visitor that validates plan safety. Analogous to Roslyn's SyntaxWalker.
 */
class PlanAstValidator {
  constructor(
    private sourceFile: ts.SourceFile,
    private options: ValidationOptions,
    private errors: PlanValidationIssue[]
  ) {}

  validate(): void {
    for (const stmt of this.sourceFile.statements) {
      this.validateTopLevelStatement(stmt);
    }
  }

  private addError(message: string, node: ts.Node): void {
    this.errors.push({
      message,
      line: getNodeLine(node, this.sourceFile),
      node,
    });
  }

  private validateTopLevelStatement(node: ts.Statement): void {
    switch (node.kind) {
      case ts.SyntaxKind.VariableStatement: {
        const varStmt = node as ts.VariableStatement;
        // Block export modifiers
        if (varStmt.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) {
          this.addError('Export declarations are not allowed in plans.', node);
          break;
        }
        this.validateVariableStatement(varStmt);
        break;
      }

      case ts.SyntaxKind.ExpressionStatement:
        this.validateExpression((node as ts.ExpressionStatement).expression);
        break;

      // Control flow — only if allowed
      case ts.SyntaxKind.ForStatement:
      case ts.SyntaxKind.ForOfStatement:
      case ts.SyntaxKind.ForInStatement:
      case ts.SyntaxKind.WhileStatement:
      case ts.SyntaxKind.DoStatement:
        if (!this.options.allowControlFlow) {
          this.addError('Control flow (loops) not allowed in PlanExecute mode. Use DesignExecute for control flow.', node);
        } else {
          this.validateControlFlowStatement(node);
        }
        break;

      case ts.SyntaxKind.IfStatement:
        if (!this.options.allowControlFlow) {
          this.addError('Control flow (if/else) not allowed in PlanExecute mode. Use DesignExecute for control flow.', node);
        } else {
          this.validateIfStatement(node as ts.IfStatement);
        }
        break;

      case ts.SyntaxKind.TryStatement:
        if (!this.options.allowControlFlow) {
          this.addError('Control flow (try/catch) not allowed in PlanExecute mode. Use DesignExecute for control flow.', node);
        } else {
          this.validateTryStatement(node as ts.TryStatement);
        }
        break;

      case ts.SyntaxKind.BreakStatement:
      case ts.SyntaxKind.ContinueStatement:
        if (!this.options.allowBreakContinue) {
          this.addError('break/continue not allowed.', node);
        }
        break;

      case ts.SyntaxKind.Block:
        this.validateBlock(node as ts.Block);
        break;

      // Blocked constructs
      case ts.SyntaxKind.ImportDeclaration:
      case ts.SyntaxKind.ExportDeclaration:
      case ts.SyntaxKind.ExportAssignment:
        this.addError('Import/export declarations are not allowed in plans.', node);
        break;

      case ts.SyntaxKind.FunctionDeclaration:
        this.addError('Function declarations are not allowed in plans.', node);
        break;

      case ts.SyntaxKind.ClassDeclaration:
        this.addError('Class declarations are not allowed in plans.', node);
        break;

      case ts.SyntaxKind.InterfaceDeclaration:
      case ts.SyntaxKind.TypeAliasDeclaration:
      case ts.SyntaxKind.EnumDeclaration:
        this.addError('Type declarations are not allowed in plans.', node);
        break;

      case ts.SyntaxKind.EmptyStatement:
        // Harmless, skip
        break;

      default:
        this.addError(`Unsupported statement kind: ${ts.SyntaxKind[node.kind]}`, node);
        break;
    }
  }

  private validateVariableStatement(stmt: ts.VariableStatement): void {
    for (const decl of stmt.declarationList.declarations) {
      // Validate variable name
      if (ts.isIdentifier(decl.name)) {
        const name = decl.name.text;

        if (name.startsWith('__')) {
          this.addError(`Variable name '${name}' cannot start with double underscore`, decl);
        }

        const reserved = new Set(['this', 'true', 'false', 'null', 'undefined']);
        if (reserved.has(name)) {
          this.addError(`Cannot assign to reserved name '${name}'`, decl);
        }
      }

      // Validate initializer
      if (decl.initializer) {
        this.validateExpression(decl.initializer);
      }
    }
  }

  private validateExpression(node: ts.Expression): void {
    switch (node.kind) {
      // Literals — always safe
      case ts.SyntaxKind.NumericLiteral:
      case ts.SyntaxKind.StringLiteral:
      case ts.SyntaxKind.NoSubstitutionTemplateLiteral:
      case ts.SyntaxKind.TrueKeyword:
      case ts.SyntaxKind.FalseKeyword:
      case ts.SyntaxKind.NullKeyword:
      case ts.SyntaxKind.UndefinedKeyword:
        break;

      case ts.SyntaxKind.Identifier:
        this.validateIdentifier(node as ts.Identifier);
        break;

      case ts.SyntaxKind.ThisKeyword:
        // Allow this.method() when allowSelfCalls is enabled (handled in call/property validators)
        // Block bare `this` in other contexts (e.g., `const x = this`)
        if (!this.options.allowSelfCalls) {
          this.addError("'this' keyword is not allowed.", node);
        }
        // When allowSelfCalls is true, this is only valid as part of this.primitive() —
        // the call validator handles the check, so we allow it through here.
        break;

      case ts.SyntaxKind.ArrayLiteralExpression:
        for (const elem of (node as ts.ArrayLiteralExpression).elements) {
          this.validateExpression(elem);
        }
        break;

      case ts.SyntaxKind.ObjectLiteralExpression:
        for (const prop of (node as ts.ObjectLiteralExpression).properties) {
          if (ts.isPropertyAssignment(prop)) {
            this.validateExpression(prop.initializer);
          } else if (ts.isShorthandPropertyAssignment(prop)) {
            // shorthand { x } is fine — it's a variable reference
          } else if (ts.isSpreadAssignment(prop)) {
            this.validateExpression(prop.expression);
          }
        }
        break;

      case ts.SyntaxKind.PropertyAccessExpression:
        this.validatePropertyAccess(node as ts.PropertyAccessExpression);
        break;

      case ts.SyntaxKind.ElementAccessExpression: {
        const elemAccess = node as ts.ElementAccessExpression;
        // Block bracket access on `this` — only this.method() dot-access is allowed
        if (elemAccess.expression.kind === ts.SyntaxKind.ThisKeyword) {
          this.addError('Bracket access on this is not allowed. Use this.method() syntax.', node);
          break;
        }
        this.validateExpression(elemAccess.expression);
        this.validateExpression(elemAccess.argumentExpression);
        break;
      }

      case ts.SyntaxKind.CallExpression:
        this.validateCallExpression(node as ts.CallExpression);
        break;

      case ts.SyntaxKind.BinaryExpression:
        if (this.options.allowControlFlow) {
          const bin = node as ts.BinaryExpression;
          this.validateExpression(bin.left);
          this.validateExpression(bin.right);
        } else {
          // In PlanExecute mode, only allow simple binary ops
          const bin = node as ts.BinaryExpression;
          const allowedBinaryOps = new Set([
            ts.SyntaxKind.PlusToken, ts.SyntaxKind.MinusToken,
            ts.SyntaxKind.AsteriskToken, ts.SyntaxKind.SlashToken,
            ts.SyntaxKind.PercentToken,
            ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken,
            ts.SyntaxKind.LessThanToken, ts.SyntaxKind.GreaterThanToken,
            ts.SyntaxKind.LessThanEqualsToken, ts.SyntaxKind.GreaterThanEqualsToken,
            ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken,
          ]);
          if (!allowedBinaryOps.has(bin.operatorToken.kind)) {
            this.addError(`Binary operator '${bin.operatorToken.getText(this.sourceFile)}' is not allowed`, bin);
          }
          this.validateExpression(bin.left);
          this.validateExpression(bin.right);
        }
        break;

      case ts.SyntaxKind.PrefixUnaryExpression: {
        const prefix = node as ts.PrefixUnaryExpression;
        this.validateExpression(prefix.operand);
        break;
      }

      case ts.SyntaxKind.PostfixUnaryExpression:
        if (this.options.allowControlFlow) {
          const postfix = node as ts.PostfixUnaryExpression;
          this.validateExpression(postfix.operand);
        } else {
          this.addError('Postfix operations (++ / --) not allowed in PlanExecute mode.', node);
        }
        break;

      case ts.SyntaxKind.ConditionalExpression: {
        const cond = node as ts.ConditionalExpression;
        this.validateExpression(cond.condition);
        this.validateExpression(cond.whenTrue);
        this.validateExpression(cond.whenFalse);
        break;
      }

      case ts.SyntaxKind.TemplateExpression: {
        const tmpl = node as ts.TemplateExpression;
        for (const span of tmpl.templateSpans) {
          this.validateExpression(span.expression);
        }
        break;
      }

      case ts.SyntaxKind.ParenthesizedExpression:
        this.validateExpression((node as ts.ParenthesizedExpression).expression);
        break;

      case ts.SyntaxKind.SpreadElement:
        this.validateExpression((node as ts.SpreadElement).expression);
        break;

      case ts.SyntaxKind.TypeOfExpression:
        this.validateExpression((node as ts.TypeOfExpression).expression);
        break;

      case ts.SyntaxKind.AsExpression:
        this.validateExpression((node as ts.AsExpression).expression);
        break;

      case ts.SyntaxKind.AwaitExpression:
        this.validateExpression((node as ts.AwaitExpression).expression);
        break;

      case ts.SyntaxKind.ArrowFunction:
      case ts.SyntaxKind.FunctionExpression:
        this.addError('Function expressions and arrow functions are not allowed in plans.', node);
        break;

      case ts.SyntaxKind.NewExpression:
        this.addError('new expressions are not allowed in plans.', node);
        break;

      case ts.SyntaxKind.DeleteExpression:
        this.addError('delete expressions are not allowed in plans.', node);
        break;

      default:
        this.addError(`Unsupported expression kind: ${ts.SyntaxKind[node.kind]}`, node);
        break;
    }
  }

  private validateIdentifier(node: ts.Identifier): void {
    const name = node.text;

    if (name.startsWith('__') && !name.startsWith('__osai_guard_')) {
      this.addError(`Access to dunder name '${name}' is not allowed`, node);
    }

    if (DANGEROUS_BUILTINS.has(name)) {
      this.addError(`Access to dangerous builtin '${name}' is not allowed`, node);
    }

    if (DANGEROUS_TYPES.has(name)) {
      this.addError(`Access to dangerous type '${name}' is not allowed`, node);
    }
  }

  private validatePropertyAccess(node: ts.PropertyAccessExpression): void {
    const propName = node.name.text;

    // Disallow private access
    if (propName.startsWith('_') && propName !== '_') {
      // Allow 'this._' pattern only if it doesn't start with underscore
      const isThisAccess = ts.isIdentifier(node.expression) && node.expression.text === 'this';
      if (!isThisAccess) {
        this.addError(`Access to private member '${propName}' is not allowed`, node);
      }
    }

    if (DANGEROUS_BUILTINS.has(propName)) {
      this.addError(`Access to dangerous property '${propName}' is not allowed`, node);
    }

    this.validateExpression(node.expression);
  }

  private validateCallExpression(node: ts.CallExpression): void {
    const callee = node.expression;
    let methodName: string;

    if (ts.isIdentifier(callee)) {
      methodName = callee.text;
    } else if (ts.isPropertyAccessExpression(callee)) {
      const fullName = resolveCalleeName(callee, this.sourceFile);

      // Handle this.method() calls
      if (fullName.startsWith('this.')) {
        if (!this.options.allowSelfCalls) {
          this.addError("'this.' prefix is not allowed in calls", node);
          return;
        }
        methodName = fullName.slice(5);
      } else {
        // Method call on a variable: result.map(), arr.filter(), etc.
        const parts = fullName.split('.');
        const method = parts[parts.length - 1];

        if (SAFE_INSTANCE_METHODS.has(method)) {
          // Safe instance method — validate the object and args
          this.validateExpression(callee.expression);
          for (const arg of node.arguments) {
            this.validateExpression(arg);
          }
          return;
        }

        // Check if it's a known builtin like JSON.stringify, Math.floor
        if (this.options.allowedBuiltins.has(parts[0])) {
          for (const arg of node.arguments) {
            this.validateExpression(arg);
          }
          return;
        }

        this.addError(
          `Method call '${fullName}' is not an allowed primitive, builtin, or safe instance method.`,
          node
        );
        return;
      }
    } else {
      this.addError('Only named function calls are allowed', node);
      return;
    }

    // Check against allowed primitives and builtins
    const isPrimitive = this.options.primitiveNames.has(methodName);
    const isBuiltin = this.options.allowedBuiltins.has(methodName);

    if (!isPrimitive && !isBuiltin) {
      this.addError(
        `Function '${methodName}' is not allowed. Only primitives and allowed builtins can be called.`,
        node
      );
    }

    if (methodName.startsWith('_')) {
      this.addError(`Calls to private methods like '${methodName}' are not allowed`, node);
    }

    if (DANGEROUS_BUILTINS.has(methodName)) {
      this.addError(`Call to dangerous builtin '${methodName}' is not allowed`, node);
    }

    // Validate arguments
    for (const arg of node.arguments) {
      this.validateExpression(arg);
    }
  }

  private validateControlFlowStatement(node: ts.Statement): void {
    if (ts.isForStatement(node)) {
      if (node.initializer) {
        if (ts.isVariableDeclarationList(node.initializer)) {
          for (const decl of node.initializer.declarations) {
            if (decl.initializer) this.validateExpression(decl.initializer);
          }
        } else {
          this.validateExpression(node.initializer);
        }
      }
      if (node.condition) this.validateExpression(node.condition);
      if (node.incrementor) this.validateExpression(node.incrementor);
      this.validateStatementBody(node.statement);
    } else if (ts.isForOfStatement(node)) {
      if (ts.isVariableDeclarationList(node.initializer)) {
        // fine — loop variable
      } else {
        this.validateExpression(node.initializer as ts.Expression);
      }
      this.validateExpression(node.expression);
      this.validateStatementBody(node.statement);
    } else if (ts.isForInStatement(node)) {
      this.addError('for...in loops are not allowed. Use for...of instead.', node);
    } else if (ts.isWhileStatement(node)) {
      this.validateExpression(node.expression);
      this.validateStatementBody(node.statement);
    } else if (ts.isDoStatement(node)) {
      this.validateExpression(node.expression);
      this.validateStatementBody(node.statement);
    }
  }

  private validateIfStatement(node: ts.IfStatement): void {
    this.validateExpression(node.expression);
    this.validateStatementBody(node.thenStatement);
    if (node.elseStatement) {
      if (ts.isIfStatement(node.elseStatement)) {
        this.validateIfStatement(node.elseStatement);
      } else {
        this.validateStatementBody(node.elseStatement);
      }
    }
  }

  private validateTryStatement(node: ts.TryStatement): void {
    this.validateBlock(node.tryBlock);
    if (node.catchClause) {
      this.validateBlock(node.catchClause.block);
    }
    if (node.finallyBlock) {
      this.validateBlock(node.finallyBlock);
    }
  }

  private validateBlock(block: ts.Block): void {
    for (const stmt of block.statements) {
      this.validateTopLevelStatement(stmt);
    }
  }

  private validateStatementBody(node: ts.Statement): void {
    if (ts.isBlock(node)) {
      this.validateBlock(node);
    } else {
      this.validateTopLevelStatement(node);
    }
  }
}
