/**
 * Plan interpreter that executes TypeScript AST nodes.
 *
 * Walks ts.Node types from the TypeScript Compiler API instead of
 * custom AST types. Evaluates expressions recursively, calls primitives
 * through the namespace, and manages variable assignments — all without eval().
 */

import ts from 'typescript';
import type {
  ExecutionStep,
  ArgumentValue,
  MutationHookContext,
} from '../models.js';
import { MutationRejectedError, OperationError } from '../exceptions.js';
import { nodeToString, resolveCalleeName } from '../parser/ts-parser.js';
import { ExecutionNamespace } from './namespace.js';

export interface InterpreterOptions {
  onMutation?: (context: MutationHookContext) => string | null | undefined;
  skipResultSerialization?: boolean;
}

export interface InterpretResult {
  steps: ExecutionStep[];
  success: boolean;
  finalValue: unknown;
  finalVariable: string;
}

export class PlanInterpreter {
  protected namespace: ExecutionNamespace;
  protected options: InterpreterOptions;
  protected sourceFile: ts.SourceFile = null as unknown as ts.SourceFile;
  private totalPrimitiveCalls = 0;
  private maxTotalPrimitiveCalls = Infinity;

  constructor(namespace: ExecutionNamespace, options: InterpreterOptions = {}) {
    this.namespace = namespace;
    this.options = options;
  }

  setMaxPrimitiveCalls(max: number): void {
    this.maxTotalPrimitiveCalls = max;
  }

  async execute(sourceFile: ts.SourceFile): Promise<InterpretResult> {
    this.sourceFile = sourceFile;
    this.totalPrimitiveCalls = 0;
    const steps: ExecutionStep[] = [];
    let finalValue: unknown = undefined;
    let finalVariable = '';

    for (let i = 0; i < sourceFile.statements.length; i++) {
      const stmt = sourceFile.statements[i];
      const result = await this.executeStatement(stmt, i + 1);

      if (Array.isArray(result)) {
        // Control flow statements can produce multiple steps
        steps.push(...result);
        const last = result[result.length - 1];
        if (last?.success) {
          finalValue = last.resultValue;
          finalVariable = last.variableName;
        } else if (last && !last.success) {
          return { steps, success: false, finalValue, finalVariable };
        }
      } else {
        steps.push(result);
        if (result.success) {
          finalValue = result.resultValue;
          finalVariable = result.variableName;
        } else {
          return { steps, success: false, finalValue, finalVariable };
        }
      }
    }

    return { steps, success: true, finalValue, finalVariable };
  }

  async executeStatement(
    stmt: ts.Statement,
    stepNumber: number
  ): Promise<ExecutionStep | ExecutionStep[]> {
    const startTime = performance.now();
    const namespaceBefore = this.namespace.serializableSnapshot();
    const statementStr = nodeToString(stmt, this.sourceFile);

    try {
      if (ts.isVariableStatement(stmt)) {
        // Handle multi-declaration: const a = 1, b = 2
        if (stmt.declarationList.declarations.length > 1) {
          const steps: ExecutionStep[] = [];
          for (const decl of stmt.declarationList.declarations) {
            const singleStmt = ts.factory.createVariableStatement(
              undefined,
              ts.factory.createVariableDeclarationList([decl], stmt.declarationList.flags)
            );
            const step = await this.executeVariableStatement(singleStmt, stepNumber + steps.length, performance.now(), this.namespace.serializableSnapshot(), nodeToString(decl, this.sourceFile));
            steps.push(step);
            if (!step.success) return steps;
          }
          return steps;
        }
        return await this.executeVariableStatement(stmt, stepNumber, startTime, namespaceBefore, statementStr);
      }

      if (ts.isExpressionStatement(stmt)) {
        const value = await this.evaluateExpression(stmt.expression);
        const elapsed = (performance.now() - startTime) / 1000;
        return this.buildStep(stepNumber, statementStr, '', null, {}, namespaceBefore, value, elapsed, true);
      }

      // For control flow, subclasses (DesignInterpreter) will handle these
      if (
        ts.isForStatement(stmt) || ts.isForOfStatement(stmt) ||
        ts.isWhileStatement(stmt) || ts.isDoStatement(stmt) ||
        ts.isIfStatement(stmt) || ts.isTryStatement(stmt) ||
        ts.isBlock(stmt) || ts.isThrowStatement(stmt) ||
        ts.isBreakStatement(stmt) || ts.isContinueStatement(stmt)
      ) {
        return await this.executeControlFlow(stmt, stepNumber);
      }

      throw new OperationError(
        `Unsupported statement kind: ${ts.SyntaxKind[stmt.kind]}`,
        'interpreter'
      );
    } catch (e) {
      const elapsed = (performance.now() - startTime) / 1000;
      const error = e instanceof Error ? e.message : String(e);
      return this.buildStep(stepNumber, statementStr, '', null, {}, namespaceBefore, undefined, elapsed, false, error);
    }
  }

  protected async executeControlFlow(
    _stmt: ts.Statement,
    _stepNumber: number
  ): Promise<ExecutionStep | ExecutionStep[]> {
    throw new OperationError(
      'Control flow is not supported in PlanExecute mode. Use DesignExecute.',
      'interpreter'
    );
  }

  private async executeVariableStatement(
    stmt: ts.VariableStatement,
    stepNumber: number,
    startTime: number,
    namespaceBefore: Record<string, unknown>,
    statementStr: string
  ): Promise<ExecutionStep> {
    const decl = stmt.declarationList.declarations[0];
    const varName = ts.isIdentifier(decl.name) ? decl.name.text : '';

    // Check for mutation before executing
    if (decl.initializer && ts.isCallExpression(decl.initializer)) {
      await this.checkMutation(decl.initializer, statementStr, stepNumber, namespaceBefore);
    }

    const value = decl.initializer
      ? await this.evaluateExpression(decl.initializer)
      : undefined;

    // Safety: primitives must not return functions
    if (typeof value === 'function') {
      throw new OperationError(
        'Primitive returned a function, which is not allowed for security reasons',
        decl.initializer ? nodeToString(decl.initializer, this.sourceFile) : 'expression'
      );
    }

    this.namespace.set(varName, value);

    const elapsed = (performance.now() - startTime) / 1000;
    const args = decl.initializer && ts.isCallExpression(decl.initializer)
      ? this.buildArgRecord(decl.initializer)
      : {};
    const primitiveCalled = decl.initializer && ts.isCallExpression(decl.initializer)
      ? this.resolvePrimitiveName(resolveCalleeName(decl.initializer.expression, this.sourceFile))
      : null;

    return this.buildStep(stepNumber, statementStr, varName, primitiveCalled, args, namespaceBefore, value, elapsed, true);
  }

  async evaluateExpression(node: ts.Expression): Promise<unknown> {
    switch (node.kind) {
      case ts.SyntaxKind.NumericLiteral:
        return parseFloat((node as ts.NumericLiteral).text);

      case ts.SyntaxKind.StringLiteral:
      case ts.SyntaxKind.NoSubstitutionTemplateLiteral:
        return (node as ts.StringLiteral).text;

      case ts.SyntaxKind.TrueKeyword:
        return true;

      case ts.SyntaxKind.FalseKeyword:
        return false;

      case ts.SyntaxKind.NullKeyword:
        return null;

      case ts.SyntaxKind.UndefinedKeyword:
        return undefined;

      case ts.SyntaxKind.Identifier:
        return this.namespace.get((node as ts.Identifier).text);

      case ts.SyntaxKind.ArrayLiteralExpression: {
        const arr = node as ts.ArrayLiteralExpression;
        return Promise.all(arr.elements.map((e) => this.evaluateExpression(e)));
      }

      case ts.SyntaxKind.ObjectLiteralExpression:
        return this.evaluateObjectLiteral(node as ts.ObjectLiteralExpression);

      case ts.SyntaxKind.PropertyAccessExpression: {
        const pa = node as ts.PropertyAccessExpression;
        const obj = await this.evaluateExpression(pa.expression);
        if (obj === null || obj === undefined) {
          throw new OperationError(
            `Cannot access property '${pa.name.text}' of ${obj}`,
            'property_access'
          );
        }
        return (obj as Record<string, unknown>)[pa.name.text];
      }

      case ts.SyntaxKind.ElementAccessExpression: {
        const ea = node as ts.ElementAccessExpression;
        const obj = await this.evaluateExpression(ea.expression);
        const key = await this.evaluateExpression(ea.argumentExpression);
        if (obj === null || obj === undefined) {
          throw new OperationError(
            `Cannot access element of ${obj}`,
            'element_access'
          );
        }
        return (obj as Record<string | number, unknown>)[key as string | number];
      }

      case ts.SyntaxKind.CallExpression:
        return this.executeCall(node as ts.CallExpression);

      case ts.SyntaxKind.BinaryExpression:
        return this.evaluateBinary(node as ts.BinaryExpression);

      case ts.SyntaxKind.PrefixUnaryExpression: {
        const prefix = node as ts.PrefixUnaryExpression;
        const operand = await this.evaluateExpression(prefix.operand);
        switch (prefix.operator) {
          case ts.SyntaxKind.MinusToken: return -(operand as number);
          case ts.SyntaxKind.PlusToken: return +(operand as number);
          case ts.SyntaxKind.ExclamationToken: return !operand;
          case ts.SyntaxKind.TildeToken: return ~(operand as number);
          default: throw new OperationError(`Unsupported prefix operator`, 'prefix');
        }
      }

      case ts.SyntaxKind.PostfixUnaryExpression: {
        const postfix = node as ts.PostfixUnaryExpression;
        const val = await this.evaluateExpression(postfix.operand) as number;
        // Handle i++ / i-- by updating the variable
        if (ts.isIdentifier(postfix.operand)) {
          const newVal = postfix.operator === ts.SyntaxKind.PlusPlusToken ? val + 1 : val - 1;
          this.namespace.set(postfix.operand.text, newVal);
        }
        return val; // postfix returns original value
      }

      case ts.SyntaxKind.ConditionalExpression: {
        const cond = node as ts.ConditionalExpression;
        const test = await this.evaluateExpression(cond.condition);
        return test
          ? this.evaluateExpression(cond.whenTrue)
          : this.evaluateExpression(cond.whenFalse);
      }

      case ts.SyntaxKind.TemplateExpression: {
        const tmpl = node as ts.TemplateExpression;
        let result = tmpl.head.text;
        for (const span of tmpl.templateSpans) {
          const val = await this.evaluateExpression(span.expression);
          result += String(val) + span.literal.text;
        }
        return result;
      }

      case ts.SyntaxKind.ParenthesizedExpression:
        return this.evaluateExpression((node as ts.ParenthesizedExpression).expression);

      case ts.SyntaxKind.SpreadElement:
        return this.evaluateExpression((node as ts.SpreadElement).expression);

      case ts.SyntaxKind.TypeOfExpression: {
        const val = await this.evaluateExpression((node as ts.TypeOfExpression).expression);
        return typeof val;
      }

      case ts.SyntaxKind.AsExpression:
        return this.evaluateExpression((node as ts.AsExpression).expression);

      case ts.SyntaxKind.AwaitExpression:
        return this.evaluateExpression((node as ts.AwaitExpression).expression);

      case ts.SyntaxKind.NewExpression: {
        // Only allow `new Error(...)` — used by loop guard injection
        const newExpr = node as ts.NewExpression;
        if (ts.isIdentifier(newExpr.expression) && newExpr.expression.text === 'Error') {
          const args = newExpr.arguments ? await this.evaluateArgs(newExpr.arguments as unknown as ts.NodeArray<ts.Expression>) : [];
          return new Error(args[0] as string ?? 'Unknown error');
        }
        throw new OperationError('new expressions are not allowed (except Error for loop guards)', 'new_expression');
      }

      default:
        throw new OperationError(
          `Unsupported expression kind: ${ts.SyntaxKind[node.kind]}`,
          'expression'
        );
    }
  }

  private async evaluateObjectLiteral(node: ts.ObjectLiteralExpression): Promise<Record<string, unknown>> {
    const result: Record<string, unknown> = {};
    for (const prop of node.properties) {
      if (ts.isPropertyAssignment(prop)) {
        let key: string;
        if (ts.isIdentifier(prop.name)) {
          key = prop.name.text;
        } else if (ts.isStringLiteral(prop.name)) {
          key = prop.name.text;
        } else if (ts.isNumericLiteral(prop.name)) {
          key = prop.name.text;
        } else if (ts.isComputedPropertyName(prop.name)) {
          key = String(await this.evaluateExpression(prop.name.expression));
        } else {
          key = nodeToString(prop.name, this.sourceFile);
        }
        result[key] = await this.evaluateExpression(prop.initializer);
      } else if (ts.isShorthandPropertyAssignment(prop)) {
        const name = prop.name.text;
        result[name] = this.namespace.get(name);
      } else if (ts.isSpreadAssignment(prop)) {
        const spread = await this.evaluateExpression(prop.expression);
        Object.assign(result, spread);
      }
    }
    return result;
  }

  private async evaluateBinary(node: ts.BinaryExpression): Promise<unknown> {
    // Handle assignment operators
    if (node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const value = await this.evaluateExpression(node.right);
      if (ts.isIdentifier(node.left)) {
        this.namespace.set(node.left.text, value);
      }
      return value;
    }

    // Handle compound assignment (+=, -=, etc.)
    if (node.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken ||
        node.operatorToken.kind === ts.SyntaxKind.MinusEqualsToken ||
        node.operatorToken.kind === ts.SyntaxKind.AsteriskEqualsToken ||
        node.operatorToken.kind === ts.SyntaxKind.SlashEqualsToken) {
      const left = await this.evaluateExpression(node.left);
      const right = await this.evaluateExpression(node.right);
      let result: unknown;
      switch (node.operatorToken.kind) {
        case ts.SyntaxKind.PlusEqualsToken: result = (left as number) + (right as number); break;
        case ts.SyntaxKind.MinusEqualsToken: result = (left as number) - (right as number); break;
        case ts.SyntaxKind.AsteriskEqualsToken: result = (left as number) * (right as number); break;
        case ts.SyntaxKind.SlashEqualsToken: result = (left as number) / (right as number); break;
        default: result = left;
      }
      if (ts.isIdentifier(node.left)) {
        this.namespace.set(node.left.text, result);
      }
      return result;
    }

    const left = await this.evaluateExpression(node.left);
    const right = await this.evaluateExpression(node.right);

    switch (node.operatorToken.kind) {
      // + handles both numeric addition and string concatenation
      case ts.SyntaxKind.PlusToken:
        if (typeof left === 'string' || typeof right === 'string') return String(left) + String(right);
        return (left as number) + (right as number);
      case ts.SyntaxKind.MinusToken: return (left as number) - (right as number);
      case ts.SyntaxKind.AsteriskToken: return (left as number) * (right as number);
      case ts.SyntaxKind.SlashToken: return (left as number) / (right as number);
      case ts.SyntaxKind.PercentToken: return (left as number) % (right as number);
      case ts.SyntaxKind.AsteriskAsteriskToken: return (left as number) ** (right as number);
      case ts.SyntaxKind.EqualsEqualsToken: return left == right;
      case ts.SyntaxKind.EqualsEqualsEqualsToken: return left === right;
      case ts.SyntaxKind.ExclamationEqualsToken: return left != right;
      case ts.SyntaxKind.ExclamationEqualsEqualsToken: return left !== right;
      case ts.SyntaxKind.LessThanToken: return (left as number) < (right as number);
      case ts.SyntaxKind.GreaterThanToken: return (left as number) > (right as number);
      case ts.SyntaxKind.LessThanEqualsToken: return (left as number) <= (right as number);
      case ts.SyntaxKind.GreaterThanEqualsToken: return (left as number) >= (right as number);
      case ts.SyntaxKind.AmpersandAmpersandToken: return left && right;
      case ts.SyntaxKind.BarBarToken: return left || right;
      case ts.SyntaxKind.QuestionQuestionToken: return left ?? right;
      case ts.SyntaxKind.InKeyword:
        throw new OperationError('in operator is not allowed in plans', 'binary');
      case ts.SyntaxKind.InstanceOfKeyword:
        throw new OperationError('instanceof is not allowed in plans', 'binary');
      default:
        throw new OperationError(
          `Unsupported binary operator: ${ts.SyntaxKind[node.operatorToken.kind]}`,
          'binary'
        );
    }
  }

  private async executeCall(node: ts.CallExpression): Promise<unknown> {
    const callee = node.expression;

    // Handle method calls: obj.method(args)
    if (ts.isPropertyAccessExpression(callee)) {
      return this.executeMethodCall(callee, node.arguments);
    }

    // Handle direct function calls: func(args)
    if (ts.isIdentifier(callee)) {
      const fnName = callee.text;
      const fn = this.namespace.get(fnName);
      if (typeof fn !== 'function') {
        throw new OperationError(`'${fnName}' is not a function`, fnName);
      }

      this.trackPrimitiveCall(fnName);
      const args = await this.evaluateArgs(node.arguments);
      return await fn(...args);
    }

    throw new OperationError('Unsupported call expression', 'call');
  }

  private async executeMethodCall(
    callee: ts.PropertyAccessExpression,
    callArgs: ts.NodeArray<ts.Expression>
  ): Promise<unknown> {
    const fullName = resolveCalleeName(callee, this.sourceFile);

    // Handle this.method() — delegate to namespace primitive lookup
    if (ts.isIdentifier(callee.expression) && callee.expression.text === 'this') {
      const methodName = callee.name.text;
      const fn = this.namespace.get(`this.${methodName}`);
      if (typeof fn !== 'function') {
        throw new OperationError(`'this.${methodName}' is not a function`, methodName);
      }
      this.trackPrimitiveCall(methodName);
      const args = await this.evaluateArgs(callArgs);
      return await fn(...args);
    }

    // Handle obj.method() — evaluate the object, then call the method
    const obj = await this.evaluateExpression(callee.expression);
    if (obj === null || obj === undefined) {
      throw new OperationError(`Cannot call method '${callee.name.text}' on ${obj}`, fullName);
    }

    const method = (obj as Record<string, unknown>)[callee.name.text];
    if (typeof method !== 'function') {
      throw new OperationError(`'${fullName}' is not a function`, fullName);
    }

    const args = await this.evaluateArgs(callArgs);
    return await method.call(obj, ...args);
  }

  protected async evaluateArgs(args: ts.NodeArray<ts.Expression>): Promise<unknown[]> {
    const result: unknown[] = [];
    for (const arg of args) {
      if (ts.isSpreadElement(arg)) {
        const spread = await this.evaluateExpression(arg.expression);
        if (Array.isArray(spread)) {
          result.push(...spread);
        } else {
          result.push(spread);
        }
      } else {
        result.push(await this.evaluateExpression(arg));
      }
    }
    return result;
  }

  private async checkMutation(
    callExpr: ts.CallExpression,
    statementStr: string,
    stepNumber: number,
    namespaceBefore: Record<string, unknown>
  ): Promise<void> {
    const calleeName = resolveCalleeName(callExpr.expression, this.sourceFile);
    const primitiveName = this.resolvePrimitiveName(calleeName);

    if (
      this.namespace.isPrimitive(primitiveName) &&
      !this.namespace.isReadOnly(primitiveName)
    ) {
      if (this.options.onMutation) {
        const context: MutationHookContext = {
          methodName: primitiveName,
          args: {},
          statement: statementStr,
          stepNumber,
          currentNamespace: namespaceBefore,
        };
        const rejection = this.options.onMutation(context);
        if (rejection) {
          throw new MutationRejectedError(primitiveName, rejection);
        }
      }
    }
  }

  protected resolvePrimitiveName(callee: string): string {
    if (callee.startsWith('this.')) {
      return callee.slice(5);
    }
    return callee;
  }

  private trackPrimitiveCall(name: string): void {
    if (this.namespace.isPrimitive(name) || this.namespace.isPrimitive(`this.${name}`)) {
      this.totalPrimitiveCalls++;
      if (this.totalPrimitiveCalls > this.maxTotalPrimitiveCalls) {
        throw new OperationError(
          `Exceeded maximum total primitive calls (${this.maxTotalPrimitiveCalls})`,
          'max_primitive_calls'
        );
      }
    }
  }

  private buildArgRecord(callExpr: ts.CallExpression): Record<string, ArgumentValue> {
    const result: Record<string, ArgumentValue> = {};
    callExpr.arguments.forEach((arg, i) => {
      const expr = nodeToString(arg, this.sourceFile);
      let variableRef: string | null = null;
      let resolvedValue: unknown;
      if (ts.isIdentifier(arg)) {
        variableRef = arg.text;
        try { resolvedValue = this.namespace.get(arg.text); } catch { resolvedValue = undefined; }
      } else if (ts.isNumericLiteral(arg)) {
        resolvedValue = parseFloat(arg.text);
      } else if (ts.isStringLiteral(arg)) {
        resolvedValue = arg.text;
      }
      result[`arg${i}`] = {
        expression: expr,
        resolvedValue,
        variableReference: variableRef,
      };
    });
    return result;
  }

  protected buildStep(
    stepNumber: number,
    statement: string,
    variableName: string,
    primitiveCalled: string | null,
    args: Record<string, ArgumentValue>,
    namespaceBefore: Record<string, unknown>,
    resultValue: unknown,
    timeSeconds: number,
    success: boolean,
    error?: string
  ): ExecutionStep {
    return {
      stepNumber,
      statement,
      variableName,
      primitiveCalled,
      args,
      namespaceBefore,
      namespaceAfter: this.namespace.serializableSnapshot(),
      resultType: this.getTypeName(resultValue),
      resultValue,
      resultJson: this.safeSerialize(resultValue),
      timeSeconds,
      success,
      error: error ?? null,
    };
  }

  private getTypeName(value: unknown): string {
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    if (Array.isArray(value)) return 'array';
    return typeof value;
  }

  private safeSerialize(value: unknown): string {
    if (this.options.skipResultSerialization) return 'null';
    try {
      return JSON.stringify(value);
    } catch {
      return `"<non-serializable: ${this.getTypeName(value)}>"`;
    }
  }
}
