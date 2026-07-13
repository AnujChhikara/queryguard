import { Node, SyntaxKind } from "ts-morph";
import type { Node as TsNode, ObjectLiteralExpression } from "ts-morph";
import type { QueryDescriptor, QueryFilter } from "../types.js";
import { isInsideLoop } from "../loop.js";

// Unambiguous TypeORM read methods — matched on any receiver.
const SIGNATURE_READS = new Set([
  "findOneBy", "findBy", "findAndCount", "findAndCountBy", "findOneOrFail", "findOneByOrFail", "countBy",
]);
// QueryBuilder terminals — matched on any receiver (the chain isn't parsed in v1).
const QB_TERMINALS = new Set(["getMany", "getOne", "getManyAndCount", "getRawMany", "getRawOne", "getCount"]);
// Shared with Mongoose/arrays — need a repo-like receiver (or an entity first arg).
const SHARED_READS = new Set(["find", "findOne", "count"]);
const WRITE_METHODS = new Set(["save", "insert", "update", "upsert", "increment", "decrement", "restore"]);
const DELETE_METHODS = new Set(["delete", "remove", "softDelete", "softRemove"]);

// The where is passed directly as the first arg (no options wrapper).
const BY_FORMS = new Set(["findOneBy", "findBy", "findAndCountBy", "countBy", "findOneByOrFail"]);
const SINGLE_ROW = new Set(["findOne", "findOneBy", "findOneOrFail", "findOneByOrFail", "getOne", "getRawOne"]);
const AGGREGATE = new Set(["count", "countBy", "getCount"]);

const READ_METHODS = new Set([...SIGNATURE_READS, ...QB_TERMINALS, ...SHARED_READS]);
const ALL_METHODS = new Set([...READ_METHODS, ...WRITE_METHODS, ...DELETE_METHODS]);
// Matched on any receiver; the rest need a repo-like receiver / entity arg.
const ANY_RECEIVER = new Set([...SIGNATURE_READS, ...QB_TERMINALS]);

const REPO_GETTERS = new Set(["getRepository", "getTreeRepository", "getMongoRepository", "getCustomRepository"]);
const MANAGER_NAMES = new Set(["manager", "entityManager", "em", "connection", "dataSource", "transactionalEntityManager"]);
const REPO_SUFFIX = /repository$|repo$/i;

function operationFor(method: string): QueryDescriptor["operation"] {
  if (READ_METHODS.has(method)) return "read";
  if (WRITE_METHODS.has(method)) return "write";
  if (DELETE_METHODS.has(method)) return "delete";
  return "unknown";
}

/** Is the receiver a TypeORM repository / manager, and which entity if we can tell? */
function classifyReceiver(receiver: TsNode): { isRepoLike: boolean; entity?: string } {
  if (Node.isCallExpression(receiver)) {
    const callee = receiver.getExpression();
    const name = Node.isPropertyAccessExpression(callee)
      ? callee.getName()
      : Node.isIdentifier(callee)
        ? callee.getText()
        : "";
    if (REPO_GETTERS.has(name)) {
      // The entity is the first capitalized identifier arg — handles both the
      // standard getRepository(Entity) and custom getRepository(ctx, Entity).
      const ent = receiver.getArguments().find((a) => Node.isIdentifier(a) && /^[A-Z]/.test(a.getText()));
      return { isRepoLike: true, entity: ent ? ent.getText() : undefined };
    }
    return { isRepoLike: false };
  }
  const leaf = Node.isIdentifier(receiver)
    ? receiver.getText()
    : Node.isPropertyAccessExpression(receiver)
      ? receiver.getName()
      : "";
  if (REPO_SUFFIX.test(leaf)) return { isRepoLike: true, entity: leaf.replace(REPO_SUFFIX, "") || undefined };
  if (MANAGER_NAMES.has(leaf)) return { isRepoLike: true };
  return { isRepoLike: false };
}

/** A capitalized entity identifier passed as the first arg (manager.find(User, …)). */
function entityFirstArg(args: TsNode[]): string | undefined {
  const first = args[0];
  return first && Node.isIdentifier(first) && /^[A-Z]/.test(first.getText()) ? first.getText() : undefined;
}

function literalValue(init: TsNode): string | number | boolean | undefined {
  if (Node.isStringLiteral(init) || Node.isNoSubstitutionTemplateLiteral(init)) return init.getLiteralValue();
  if (Node.isNumericLiteral(init)) return init.getLiteralValue();
  if (init.getKind() === SyntaxKind.TrueKeyword) return true;
  if (init.getKind() === SyntaxKind.FalseKeyword) return false;
  return undefined;
}

/** Extract eq/in predicates from a TypeORM where object (`{ field: value | In([]) | IsNull() }`). */
function extractWhere(where: ObjectLiteralExpression): QueryFilter[] {
  return where
    .getProperties()
    .filter(Node.isPropertyAssignment)
    .map((p): QueryFilter => {
      const field = p.getName();
      const init = p.getInitializer();
      if (!init) return { field, kind: "other" };
      const lit = literalValue(init);
      if (lit !== undefined) return { field, value: lit, kind: "eq" };
      if (Node.isCallExpression(init)) {
        const callee = init.getExpression();
        const name = Node.isIdentifier(callee) ? callee.getText() : Node.isPropertyAccessExpression(callee) ? callee.getName() : "";
        return name === "In" ? { field, kind: "in" } : { field, kind: "other" }; // IsNull()/MoreThan()/…
      }
      return { field, kind: "other" };
    });
}

export function typeormAdapter(node: TsNode): QueryDescriptor | null {
  if (!Node.isCallExpression(node)) return null;
  const call = node;
  const expr = call.getExpression();
  if (!Node.isPropertyAccessExpression(expr)) return null;
  const method = expr.getName();
  if (!ALL_METHODS.has(method)) return null;

  const args = call.getArguments();
  const { isRepoLike, entity: recvEntity } = classifyReceiver(expr.getExpression());
  const argEntity = entityFirstArg(args);

  // Disambiguation: shared method names need a positive TypeORM signal.
  if (!ANY_RECEIVER.has(method)) {
    const entityArgOk = SHARED_READS.has(method) && Boolean(argEntity);
    if (!isRepoLike && !entityArgOk) return null;
  }

  // Never mistake array .find(cb) for a query.
  const first = args[0];
  if ((method === "find" || method === "findOne") && first && (Node.isArrowFunction(first) || Node.isFunctionExpression(first))) {
    return null;
  }

  const isQbTerminal = QB_TERMINALS.has(method);
  let hasFilter: boolean | undefined;
  let hasLimit: boolean | undefined;
  let filters: QueryFilter[] = [];

  if (isQbTerminal) {
    // Fluent chain not parsed in v1 — filter/limit unknown (so no false
    // unbounded-read), except getOne/getRawOne which return a single row.
    if (SINGLE_ROW.has(method)) hasLimit = true;
  } else if (BY_FORMS.has(method)) {
    if (!first) hasFilter = false;
    else if (Node.isObjectLiteralExpression(first)) {
      filters = extractWhere(first);
      hasFilter = first.getProperties().length > 0;
    } else hasFilter = undefined; // opaque
    hasLimit = SINGLE_ROW.has(method) ? true : false;
  } else {
    // Options-object form; options is the 2nd arg when the 1st is an entity.
    const opts = argEntity ? args[1] : first;
    if (!opts) {
      hasFilter = false;
      hasLimit = false;
    } else if (Node.isObjectLiteralExpression(opts)) {
      const whereProp = opts.getProperty("where");
      const whereInit = whereProp && Node.isPropertyAssignment(whereProp) ? whereProp.getInitializer() : undefined;
      filters = whereInit && Node.isObjectLiteralExpression(whereInit) ? extractWhere(whereInit) : [];
      hasFilter = Boolean(opts.getProperty("where"));
      hasLimit = Boolean(opts.getProperty("take"));
    } // else opaque → both stay undefined
    if (SINGLE_ROW.has(method)) hasLimit = true;
  }

  return {
    db: "sql",
    orm: "typeorm",
    operation: operationFor(method),
    target: isQbTerminal ? "unknown" : (argEntity ?? recvEntity ?? "unknown"),
    node: call,
    inLoop: isInsideLoop(call),
    awaited: Boolean(call.getFirstAncestor((a) => Node.isAwaitExpression(a))),
    confidence: "high",
    hasLimit,
    hasFilter,
    filters,
    isAggregate: AGGREGATE.has(method),
  };
}
