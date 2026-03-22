/**
 * TypeScript Compiler API-based plan parser.
 *
 * Replaces the hand-rolled tokenizer/parser with the official TypeScript
 * compiler for true AST analysis. Plans are parsed as TypeScript source
 * files, producing ts.SourceFile nodes that can be walked, validated,
 * and transformed using the full TypeScript toolchain.
 */

import ts from 'typescript';
import { PlanParseError } from '../exceptions.js';

/**
 * Parse a plan source string into a TypeScript AST.
 *
 * Uses ts.createSourceFile() for full TypeScript parsing — no hand-rolled
 * tokenizer or custom AST types. The returned SourceFile IS the AST.
 */
export function parsePlan(source: string): ts.SourceFile {
  const sourceFile = ts.createSourceFile(
    'plan.ts',
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.TS
  );

  // Check for parse diagnostics
  const diagnostics = getDiagnostics(sourceFile, source);
  if (diagnostics.length > 0) {
    const first = diagnostics[0];
    throw new PlanParseError(
      first.message,
      source,
      first.line,
      first.column
    );
  }

  return sourceFile;
}

interface ParseDiagnostic {
  message: string;
  line: number;
  column: number;
}

/**
 * Extract parse diagnostics from a source file.
 * Accesses the internal parseDiagnostics directly — avoids creating
 * a full ts.Program just for syntax error checking.
 */
function getDiagnostics(sourceFile: ts.SourceFile, _source: string): ParseDiagnostic[] {
  // parseDiagnostics is populated by createSourceFile but not part of the public API
  const diagnostics: readonly ts.DiagnosticWithLocation[] =
    (sourceFile as unknown as { parseDiagnostics?: ts.DiagnosticWithLocation[] }).parseDiagnostics ?? [];

  return diagnostics.map((d) => {
    const pos = d.start ?? 0;
    const { line, character } = ts.getLineAndCharacterOfPosition(sourceFile, pos);
    return {
      message: ts.flattenDiagnosticMessageText(d.messageText, '\n'),
      line: line + 1,
      column: character + 1,
    };
  });
}

/**
 * Get the source text of a node within its source file.
 */
export function nodeToString(node: ts.Node, sourceFile: ts.SourceFile): string {
  return node.getText(sourceFile);
}

/**
 * Get the line number (1-based) of a node.
 */
export function getNodeLine(node: ts.Node, sourceFile: ts.SourceFile): number {
  const { line } = ts.getLineAndCharacterOfPosition(sourceFile, node.getStart(sourceFile));
  return line + 1;
}

/**
 * Get the line and column (1-based) of a node.
 */
export function getNodePosition(node: ts.Node, sourceFile: ts.SourceFile): { line: number; column: number } {
  const { line, character } = ts.getLineAndCharacterOfPosition(sourceFile, node.getStart(sourceFile));
  return { line: line + 1, column: character + 1 };
}

/**
 * Resolve the callee name from a call expression.
 * Handles: foo(), this.foo(), obj.method()
 */
export function resolveCalleeName(expr: ts.Expression, sourceFile: ts.SourceFile): string {
  if (ts.isIdentifier(expr)) {
    return expr.text;
  }
  if (ts.isPropertyAccessExpression(expr)) {
    const objName = resolveCalleeName(expr.expression, sourceFile);
    return `${objName}.${expr.name.text}`;
  }
  return expr.getText(sourceFile);
}

/**
 * Extract the variable name from a variable declaration statement.
 */
export function extractVariableName(stmt: ts.VariableStatement): string | null {
  const decl = stmt.declarationList.declarations[0];
  if (!decl) return null;
  if (ts.isIdentifier(decl.name)) {
    return decl.name.text;
  }
  return null;
}

/**
 * Check if a statement is a variable declaration (const/let/var).
 */
export function isVariableStatement(node: ts.Node): node is ts.VariableStatement {
  return ts.isVariableStatement(node);
}

/**
 * Check if a statement is a bare expression statement.
 */
export function isExpressionStatement(node: ts.Node): node is ts.ExpressionStatement {
  return ts.isExpressionStatement(node);
}
