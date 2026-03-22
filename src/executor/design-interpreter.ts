/**
 * DesignInterpreter - Extended plan interpreter with control flow support.
 *
 * Extends PlanInterpreter to handle for/while/do/if/try statements.
 * Used by DesignExecute for plans that need loops and conditionals.
 */

import ts from 'typescript';
import type { ExecutionStep } from '../models.js';
import { OperationError } from '../exceptions.js';
import { PlanInterpreter, type InterpreterOptions } from './interpreter.js';
import { ExecutionNamespace } from './namespace.js';

const BREAK_SIGNAL = Symbol('BREAK');
const CONTINUE_SIGNAL = Symbol('CONTINUE');

export class DesignInterpreter extends PlanInterpreter {
  constructor(namespace: ExecutionNamespace, options: InterpreterOptions = {}) {
    super(namespace, options);
  }

  protected override async executeControlFlow(
    stmt: ts.Statement,
    stepNumber: number
  ): Promise<ExecutionStep | ExecutionStep[]> {
    if (ts.isForStatement(stmt)) return this.executeFor(stmt, stepNumber);
    if (ts.isForOfStatement(stmt)) return this.executeForOf(stmt, stepNumber);
    if (ts.isWhileStatement(stmt)) return this.executeWhile(stmt, stepNumber);
    if (ts.isDoStatement(stmt)) return this.executeDo(stmt, stepNumber);
    if (ts.isIfStatement(stmt)) return this.executeIf(stmt, stepNumber);
    if (ts.isTryStatement(stmt)) return this.executeTry(stmt, stepNumber);
    if (ts.isBlock(stmt)) return this.executeBlock(stmt.statements, stepNumber);
    if (ts.isBreakStatement(stmt)) throw BREAK_SIGNAL;
    if (ts.isContinueStatement(stmt)) throw CONTINUE_SIGNAL;
    if (ts.isThrowStatement(stmt)) {
      const value = await this.evaluateExpression(stmt.expression);
      throw value instanceof Error ? value : new Error(String(value));
    }

    throw new OperationError(
      `Unsupported control flow: ${ts.SyntaxKind[stmt.kind]}`,
      'design_interpreter'
    );
  }

  private async executeFor(
    node: ts.ForStatement,
    stepNumber: number
  ): Promise<ExecutionStep[]> {
    const steps: ExecutionStep[] = [];

    // Initializer
    if (node.initializer) {
      if (ts.isVariableDeclarationList(node.initializer)) {
        for (const decl of node.initializer.declarations) {
          if (ts.isIdentifier(decl.name) && decl.initializer) {
            const val = await this.evaluateExpression(decl.initializer);
            this.namespace.set(decl.name.text, val);
          }
        }
      } else {
        await this.evaluateExpression(node.initializer);
      }
    }

    // Loop
    while (true) {
      if (node.condition) {
        const cond = await this.evaluateExpression(node.condition);
        if (!cond) break;
      }

      const bodyResult = await this.executeBody(node.statement, stepNumber + steps.length);
      if (bodyResult.steps.length > 0) steps.push(...bodyResult.steps);
      if (bodyResult.broke) break;
      if (!bodyResult.success) return steps;

      if (node.incrementor) {
        await this.evaluateExpression(node.incrementor);
      }
    }

    return steps;
  }

  private async executeForOf(
    node: ts.ForOfStatement,
    stepNumber: number
  ): Promise<ExecutionStep[]> {
    const steps: ExecutionStep[] = [];
    const iterable = await this.evaluateExpression(node.expression);

    if (!iterable || typeof (iterable as Iterable<unknown>)[Symbol.iterator] !== 'function') {
      throw new OperationError('for...of requires an iterable', 'for_of');
    }

    for (const item of iterable as Iterable<unknown>) {
      if (ts.isVariableDeclarationList(node.initializer)) {
        const decl = node.initializer.declarations[0];
        this.bindPattern(decl.name, item);
      }

      const bodyResult = await this.executeBody(node.statement, stepNumber + steps.length);
      if (bodyResult.steps.length > 0) steps.push(...bodyResult.steps);
      if (bodyResult.broke) break;
      if (!bodyResult.success) return steps;
    }

    return steps;
  }

  /**
   * Bind a pattern (identifier or destructuring) to a value in the namespace.
   */
  private bindPattern(pattern: ts.BindingName, value: unknown): void {
    if (ts.isIdentifier(pattern)) {
      this.namespace.set(pattern.text, value);
    } else if (ts.isArrayBindingPattern(pattern)) {
      const arr = value as unknown[];
      for (let i = 0; i < pattern.elements.length; i++) {
        const elem = pattern.elements[i];
        if (ts.isBindingElement(elem)) {
          this.bindPattern(elem.name, arr[i]);
        }
        // OmittedExpression elements (holes like [,x]) are skipped
      }
    } else if (ts.isObjectBindingPattern(pattern)) {
      const obj = value as Record<string, unknown>;
      for (const elem of pattern.elements) {
        if (ts.isBindingElement(elem)) {
          const key = elem.propertyName
            ? (ts.isIdentifier(elem.propertyName) ? elem.propertyName.text : String(elem.propertyName))
            : (ts.isIdentifier(elem.name) ? elem.name.text : '');
          this.bindPattern(elem.name, obj[key]);
        }
      }
    }
  }

  private async executeWhile(
    node: ts.WhileStatement,
    stepNumber: number
  ): Promise<ExecutionStep[]> {
    const steps: ExecutionStep[] = [];

    while (true) {
      const cond = await this.evaluateExpression(node.expression);
      if (!cond) break;

      const bodyResult = await this.executeBody(node.statement, stepNumber + steps.length);
      if (bodyResult.steps.length > 0) steps.push(...bodyResult.steps);
      if (bodyResult.broke) break;
      if (!bodyResult.success) return steps;
    }

    return steps;
  }

  private async executeDo(
    node: ts.DoStatement,
    stepNumber: number
  ): Promise<ExecutionStep[]> {
    const steps: ExecutionStep[] = [];

    do {
      const bodyResult = await this.executeBody(node.statement, stepNumber + steps.length);
      if (bodyResult.steps.length > 0) steps.push(...bodyResult.steps);
      if (bodyResult.broke) break;
      if (!bodyResult.success) return steps;

      const cond = await this.evaluateExpression(node.expression);
      if (!cond) break;
    // eslint-disable-next-line no-constant-condition
    } while (true);

    return steps;
  }

  private async executeIf(
    node: ts.IfStatement,
    stepNumber: number
  ): Promise<ExecutionStep[]> {
    const cond = await this.evaluateExpression(node.expression);

    if (cond) {
      return this.executeBodyStatements(node.thenStatement, stepNumber);
    } else if (node.elseStatement) {
      if (ts.isIfStatement(node.elseStatement)) {
        return this.executeIf(node.elseStatement, stepNumber);
      }
      return this.executeBodyStatements(node.elseStatement, stepNumber);
    }

    return [];
  }

  private async executeTry(
    node: ts.TryStatement,
    stepNumber: number
  ): Promise<ExecutionStep[]> {
    const steps: ExecutionStep[] = [];

    try {
      const trySteps = await this.executeBlock(node.tryBlock.statements, stepNumber);
      if (Array.isArray(trySteps)) steps.push(...trySteps);
      else steps.push(trySteps);
    } catch (e) {
      if (e === BREAK_SIGNAL || e === CONTINUE_SIGNAL) throw e;

      if (node.catchClause) {
        // Bind the error to the catch variable
        if (node.catchClause.variableDeclaration && ts.isIdentifier(node.catchClause.variableDeclaration.name)) {
          this.namespace.set(node.catchClause.variableDeclaration.name.text, e);
        }

        const catchSteps = await this.executeBlock(
          node.catchClause.block.statements,
          stepNumber + steps.length
        );
        if (Array.isArray(catchSteps)) steps.push(...catchSteps);
        else steps.push(catchSteps);
      }
    } finally {
      if (node.finallyBlock) {
        const finallySteps = await this.executeBlock(
          node.finallyBlock.statements,
          stepNumber + steps.length
        );
        if (Array.isArray(finallySteps)) steps.push(...finallySteps);
        else steps.push(finallySteps);
      }
    }

    return steps;
  }

  private async executeBlock(
    statements: ts.NodeArray<ts.Statement>,
    stepNumber: number
  ): Promise<ExecutionStep | ExecutionStep[]> {
    const steps: ExecutionStep[] = [];

    for (const stmt of statements) {
      const result = await this.executeStatement(stmt, stepNumber + steps.length);
      if (Array.isArray(result)) {
        steps.push(...result);
      } else {
        steps.push(result);
        if (!result.success) return steps;
      }
    }

    return steps;
  }

  private async executeBodyStatements(
    body: ts.Statement,
    stepNumber: number
  ): Promise<ExecutionStep[]> {
    if (ts.isBlock(body)) {
      const result = await this.executeBlock(body.statements, stepNumber);
      return Array.isArray(result) ? result : [result];
    }
    const result = await this.executeStatement(body, stepNumber);
    return Array.isArray(result) ? result : [result];
  }

  private async executeBody(
    body: ts.Statement,
    stepNumber: number
  ): Promise<{ steps: ExecutionStep[]; success: boolean; broke: boolean }> {
    try {
      const steps = await this.executeBodyStatements(body, stepNumber);
      const success = steps.every((s) => s.success);
      return { steps, success, broke: false };
    } catch (e) {
      if (e === BREAK_SIGNAL) return { steps: [], success: true, broke: true };
      if (e === CONTINUE_SIGNAL) return { steps: [], success: true, broke: false };
      throw e;
    }
  }
}
