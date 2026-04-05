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
 * Semantic validation pass.
 * @param {object} ast  acorn Program AST
 * @param {string} [filename='<input>']
 * @returns {{ warnings: string[] }}
 * @throws {Error}  listing all semantic violations
 */
export function validate(ast, filename = '<input>') {
  const errors = [];
  const warnings = [];

  /** @param {string} msg @param {object} node */
  function err(msg, node) {
    const line = node?.loc?.start?.line ?? '?';
    errors.push(`${msg} (${filename}:${line})`);
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
      // default import
      for (const spec of node.specifiers || []) {
        if (spec.local?.name) importedNames.add(spec.local.name);
      }
    }
  }

  // Context stack
  let insideClassMethod = 0;  // counter — incremented when entering class method
  let insideClass = 0;        // counter — incremented when entering class body

  walk(ast, {
    enter: {
      /** @param {object} node */
      ClassDeclaration(node)  { insideClass++; },
      /** @param {object} node */
      ClassExpression(node)   { insideClass++; },

      /** @param {object} node */
      MethodDefinition(node) {
        if (insideClass > 0) insideClassMethod++;
      },

      // ── Banned expressions ──────────────────────────────────────────────

      /** @param {object} node */
      CallExpression(node) {
        // eval(...)
        if (node.callee?.type === 'Identifier' && node.callee.name === 'eval') {
          err("eval() is not allowed", node);
        }
        // JSON.parse(...)
        if (node.callee?.type === 'MemberExpression' &&
            node.callee.object?.name === 'JSON' &&
            node.callee.property?.name === 'parse') {
          err("JSON.parse is not allowed", node);
        }
      },

      /** @param {object} node */
      NewExpression(node) {
        // new Function(...)
        if (node.callee?.type === 'Identifier' && node.callee.name === 'Function') {
          err("new Function() is not allowed", node);
        }
        // Named argument constructor: `new Foo({ key: val })` — mark the ObjectExpression as allowed
        if (node.arguments?.length === 1 && node.arguments[0]?.type === 'ObjectExpression') {
          node.arguments[0]._namedArgBlock = true;
        }
      },

      /** @param {object} node */
      UnaryExpression(node) {
        if (node.operator === 'delete') {
          err("delete is not allowed", node);
        }
      },

      /** @param {object} node */
      ObjectExpression(node) {
        // Ban standalone object literals, but allow named argument blocks inside `new Foo({...})`
        if (node._namedArgBlock) return;
        err("Object literals {} are not allowed; use class construction blocks inside new", node);
      },

      /** @param {object} node */
      IfStatement(node) {
        if (containsTypeof(node.test)) {
          err("typeof in branch condition is not allowed; use instanceof", node);
        }
      },

      /** @param {object} node */
      Identifier(node) {
        if (node.name === 'Proxy')   err("Proxy is not allowed", node);
        if (node.name === 'Reflect') err("Reflect is not allowed", node);
      },

      /** @param {object} node */
      MemberExpression(node) {
        // Math.* without import
        if (node.object?.type === 'Identifier' && node.object.name === 'Math') {
          if (!importedNames.has('Math')) {
            err("Math.* requires importing Math from 'std/math'", node);
          }
        }
        // Bracket (computed) access is supported on arrays; class fields require direct access.
      },

      /** @param {object} node */
      ThisExpression(node) {
        if (insideClassMethod === 0) {
          err("'this' is only valid inside class methods", node);
        }
      },

      /** @param {object} node */
      VariableDeclaration(node) {
        if (node.kind === 'var') {
          warn("Consider using 'let' instead of 'var'", node);
        }
      },

      // ── Function parameter defaults ──────────────────────────────────────

      /** @param {object} node */
      FunctionDeclaration(node) {
        checkParams(node.params, node, filename, errors);
      },
      /** @param {object} node */
      FunctionExpression(node) {
        checkParams(node.params, node, filename, errors);
      },
      /** @param {object} node */
      ArrowFunctionExpression(node) {
        checkParams(node.params, node, filename, errors);
      },
    },

    leave: {
      /** @param {object} node */
      ClassDeclaration(node)  { insideClass--; },
      /** @param {object} node */
      ClassExpression(node)   { insideClass--; },
      /** @param {object} node */
      MethodDefinition(node)  { if (insideClass > 0) insideClassMethod--; },
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
      errors.push(`Every parameter must have a default value (${filename}:${line})`);
    }
  }
}
