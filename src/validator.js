/**
 * @fileoverview Semantic validator — second pass over the AST.
 * Accumulates all violations before throwing, so the user sees every error at once.
 * Returns { warnings } on success; throws Error listing all violations on failure.
 */

/**
 * Full recursive AST walker with enter/leave callbacks.
 * @param {object} node
 * @param {{ enter?: Record<string, (n: object) => void>, leave?: Record<string, (n: object) => void> }} visitor
 */
function walk(node, visitor) {
  if (!node || typeof node !== 'object') return;
  const enterFn = visitor.enter?.[node.type];
  if (enterFn) enterFn(node);
  for (const key of Object.keys(node)) {
    const child = node[key];
    if (Array.isArray(child)) {
      for (const item of child) {
        if (item && typeof item === 'object' && typeof item.type === 'string') {
          walk(item, visitor);
        }
      }
    } else if (child && typeof child === 'object' && typeof child.type === 'string') {
      walk(child, visitor);
    }
  }
  const leaveFn = visitor.leave?.[node.type];
  if (leaveFn) leaveFn(node);
}

/**
 * Check whether an expression tree contains a `typeof` unary operator anywhere.
 * @param {object} node
 * @returns {boolean}
 */
function containsTypeof(node) {
  if (!node || typeof node !== 'object') return false;
  if (node.type === 'UnaryExpression' && node.operator === 'typeof') return true;
  for (const key of Object.keys(node)) {
    const child = node[key];
    if (Array.isArray(child)) {
      for (const item of child) {
        if (item && typeof item === 'object' && typeof item.type === 'string') {
          if (containsTypeof(item)) return true;
        }
      }
    } else if (child && typeof child === 'object' && typeof child.type === 'string') {
      if (containsTypeof(child)) return true;
    }
  }
  return false;
}

/**
 * Check for nested destructuring (ArrayPattern/ObjectPattern inside another pattern).
 * @param {object} id  VariableDeclarator id node
 * @returns {boolean}
 */
function hasNestedDestructuring(id) {
  if (!id) return false;
  if (id.type === 'ArrayPattern') {
    for (const el of id.elements ?? []) {
      if (el && (el.type === 'ArrayPattern' || el.type === 'ObjectPattern')) return true;
    }
  } else if (id.type === 'ObjectPattern') {
    for (const prop of id.properties ?? []) {
      const val = prop.value ?? prop;
      if (val && (val.type === 'ArrayPattern' || val.type === 'ObjectPattern')) return true;
    }
  }
  return false;
}

/**
 * Semantic validation pass.
 * @param {object} ast  acorn Program AST
 * @param {string} [filename='<input>']
 * @returns {{ warnings: string[] }}
 * @throws {Error}  listing all semantic violations
 */
export function validate(ast, filename = '<input>') {
  const errors = [];
  const warnings = [];

  /**
   * @param {string} code CE- code
   * @param {string} msg
   * @param {object} node
   */
  function err(code, msg, node) {
    const line = node?.loc?.start?.line ?? '?';
    const col  = node?.loc?.start?.column != null ? node.loc.start.column + 1 : '?';
    errors.push(`${code}: ${msg} (${filename}:${line}:${col})`);
  }

  /** @param {string} msg @param {object} node */
  function warn(msg, node) {
    const line = node?.loc?.start?.line ?? '?';
    warnings.push(`${msg} (${filename}:${line})`);
  }

  // Collect imported names to detect Math.* without import
  const importedNames = new Set();
  for (const node of ast.body) {
    if (node.type === 'ImportDeclaration') {
      for (const spec of node.specifiers || []) {
        if (spec.local?.name) importedNames.add(spec.local.name);
      }
    }
  }

  // Context stack
  let insideClassMethod = 0;  // counter — incremented when entering class method
  let insideClass = 0;        // counter — incremented when entering class body
  let loopDepth = 0;          // counter for CE-CF04

  // Scope stack for CE-V04 duplicate declaration tracking
  const scopes = [new Set()];

  function pushScope() { scopes.push(new Set()); }
  function popScope()  { scopes.pop(); }
  function currentScope() { return scopes[scopes.length - 1]; }

  function declareInScope(name, node) {
    const scope = currentScope();
    if (scope.has(name)) {
      err('CE-V04', `duplicate declaration '${name}'`, node);
    } else {
      scope.add(name);
    }
  }

  walk(ast, {
    enter: {
      /** @param {object} node */
      ClassDeclaration(node)  {
        insideClass++;
        const name = node.id?.name;
        if (name) {
          if (name.startsWith('$')) err('CE-V05', `identifier '${name}' must not start with '$'`, node.id ?? node);
          declareInScope(name, node.id ?? node);
        }
      },
      /** @param {object} node */
      ClassExpression(node)   { insideClass++; },

      /** @param {object} node */
      MethodDefinition(node) {
        if (insideClass > 0) insideClassMethod++;
        pushScope();
      },

      /** @param {object} node */
      BlockStatement(node) {
        pushScope();
        // CE-CF05: unreachable code
        const terminals = new Set(['ReturnStatement','BreakStatement','ThrowStatement','ContinueStatement']);
        const body = node.body ?? [];
        let termIdx = -1;
        for (let i = 0; i < body.length; i++) {
          if (terminals.has(body[i].type)) { termIdx = i; break; }
        }
        if (termIdx !== -1 && termIdx + 1 < body.length) {
          err('CE-CF05', 'unreachable code after return/break/throw/continue', body[termIdx + 1]);
        }
      },

      // ── Loops (for CE-CF04) ──────────────────────────────────────────────────
      /** @param {object} node */
      ForStatement(node)      { loopDepth++; pushScope(); },
      /** @param {object} node */
      ForOfStatement(node)    { loopDepth++; },
      /** @param {object} node */
      WhileStatement(node)    { loopDepth++; },
      /** @param {object} node */
      DoWhileStatement(node)  { loopDepth++; },
      /** @param {object} node */
      SwitchStatement(node) {
        loopDepth++;
        // CE-CF02: switch fallthrough
        const cases = node.cases ?? [];
        for (let i = 0; i < cases.length - 1; i++) {
          const c = cases[i];
          const conseq = c.consequent ?? [];
          if (conseq.length === 0) continue; // empty case — intentional fallthrough
          const last = conseq[conseq.length - 1];
          const isTerminal = last.type === 'BreakStatement' ||
                             last.type === 'ReturnStatement' ||
                             last.type === 'ThrowStatement';
          if (!isTerminal) {
            err('CE-CF02', 'switch case fallthrough is not allowed; add break or return', c);
          }
        }
      },

      /** @param {object} node */
      BreakStatement(node) {
        if (loopDepth === 0) err('CE-CF04', 'break outside loop or switch', node);
      },
      /** @param {object} node */
      ContinueStatement(node) {
        if (loopDepth === 0) err('CE-CF04', 'continue outside loop', node);
      },

      // ── Banned expressions ──────────────────────────────────────────────

      /** @param {object} node */
      CallExpression(node) {
        // eval(...)
        if (node.callee?.type === 'Identifier' && node.callee.name === 'eval') {
          err('CE-A02', 'eval() is not allowed', node);
        }
        // JSON.parse(...)
        if (node.callee?.type === 'MemberExpression' &&
            node.callee.object?.name === 'JSON' &&
            node.callee.property?.name === 'parse') {
          err('CE-A02', 'JSON.parse is not allowed', node);
        }
        // enum({ ... }) — mark the ObjectExpression argument as allowed
        if (node.callee?.type === 'Identifier' && node.callee.name === 'enum') {
          for (const arg of node.arguments ?? []) {
            if (arg.type === 'ObjectExpression') arg._namedArgBlock = true;
          }
        }
      },

      /** @param {object} node */
      NewExpression(node) {
        // new Function(...)
        if (node.callee?.type === 'Identifier' && node.callee.name === 'Function') {
          err('CE-A02', 'new Function() is not allowed', node);
        }
        // Named argument constructor: `new Foo({ key: val })` — mark the ObjectExpression as allowed
        if (node.arguments?.length === 1 && node.arguments[0]?.type === 'ObjectExpression') {
          node.arguments[0]._namedArgBlock = true;
        }
      },

      /** @param {object} node */
      UnaryExpression(node) {
        if (node.operator === 'delete') {
          err('CE-A06', 'delete is not allowed', node);
        }
      },

      /** @param {object} node */
      ObjectExpression(node) {
        // Ban standalone object literals, but allow named argument blocks inside `new Foo({...})`
        if (node._namedArgBlock) return;
        err('CE-A08', 'object literals {} are not allowed; use class construction blocks inside new', node);
      },

      /** @param {object} node */
      IfStatement(node) {
        if (containsTypeof(node.test)) {
          err('CE-T11', 'typeof in branch condition is not allowed; use instanceof', node);
        }
      },

      /** @param {object} node */
      Identifier(node) {
        if (node.name === 'Proxy')   err('CE-A09', 'Proxy is not allowed', node);
        if (node.name === 'Reflect') err('CE-A09', 'Reflect is not allowed', node);
      },

      /** @param {object} node */
      MemberExpression(node) {
        // Math.* without import
        if (node.object?.type === 'Identifier' && node.object.name === 'Math') {
          if (!importedNames.has('Math')) {
            err('CE-A09', "Math.* requires importing Math from 'std/math'", node);
          }
        }
        // CE-A03: prototype access
        const propName = node.property?.name;
        if (propName === '__proto__' || propName === 'prototype') {
          err('CE-A03', `access to '${propName}' is not allowed`, node);
        }
      },

      /** @param {object} node */
      ThisExpression(node) {
        if (insideClassMethod === 0) {
          err('CE-C05', "'this' is only valid inside class methods", node);
        }
      },

      /** @param {object} node */
      VariableDeclaration(node) {
        if (node.kind === 'var') {
          err('CE-V06', "use 'let' or 'const' instead of 'var'", node);
        }
      },

      /** @param {object} node */
      VariableDeclarator(node) {
        const id = node.id;
        if (!id) return;
        const name = id.name;
        if (name) {
          if (name.startsWith('$')) err('CE-V05', `identifier '${name}' must not start with '$'`, id);
          declareInScope(name, id);
        }
        // CE-A04: nested destructuring
        if (hasNestedDestructuring(id)) {
          err('CE-A04', 'nested destructuring is not allowed', id);
        }
      },

      // ── Function parameter defaults ──────────────────────────────────────

      /** @param {object} node */
      FunctionDeclaration(node) {
        const name = node.id?.name;
        if (name) {
          if (name.startsWith('$')) err('CE-V05', `identifier '${name}' must not start with '$'`, node.id);
          declareInScope(name, node.id ?? node);
        }
        checkParams(node.params, node, filename, errors);
        pushScope();
      },
      /** @param {object} node */
      FunctionExpression(node) {
        checkParams(node.params, node, filename, errors);
        pushScope();
      },
      /** @param {object} node */
      ArrowFunctionExpression(node) {
        checkParams(node.params, node, filename, errors);
        pushScope();
      },
    },

    leave: {
      /** @param {object} node */
      ClassDeclaration(node)  { insideClass--; },
      /** @param {object} node */
      ClassExpression(node)   { insideClass--; },
      /** @param {object} node */
      MethodDefinition(node)  {
        if (insideClass > 0) insideClassMethod--;
        popScope();
      },
      /** @param {object} node */
      BlockStatement(node)    { popScope(); },
      /** @param {object} node */
      ForStatement(node)      { loopDepth--; popScope(); },
      /** @param {object} node */
      ForOfStatement(node)    { loopDepth--; },
      /** @param {object} node */
      WhileStatement(node)    { loopDepth--; },
      /** @param {object} node */
      DoWhileStatement(node)  { loopDepth--; },
      /** @param {object} node */
      SwitchStatement(node)   { loopDepth--; },
      /** @param {object} node */
      FunctionDeclaration(node) { popScope(); },
      /** @param {object} node */
      FunctionExpression(node)  { popScope(); },
      /** @param {object} node */
      ArrowFunctionExpression(node) { popScope(); },
    },
  });

  if (errors.length > 0) throw new Error(errors.join('\n'));
  return { warnings };
}

/**
 * Verify every parameter in a param list is an AssignmentPattern (has a default).
 * @param {object[]} params
 * @param {object} fnNode
 * @param {string} filename
 * @param {string[]} errors
 */
function checkParams(params, fnNode, filename, errors) {
  for (const p of params) {
    if (p.type !== 'AssignmentPattern' && p.type !== 'RestElement') {
      const line = p?.loc?.start?.line ?? fnNode?.loc?.start?.line ?? '?';
      const col  = p?.loc?.start?.column != null ? p.loc.start.column + 1 : '?';
      errors.push(`CE-F01: every parameter must have a default value (${filename}:${line}:${col})`);
    }
  }
}
