# TypeORM adapter — design

## Motivation

TypeORM is one of the most-used Node ORMs. Cardinal's heuristic fallback already
catches some of it (`repo.find`/`findOne`), but as *warnings*, and it misses the
TypeORM-specific methods (`findOneBy`, `findBy`, `findAndCount`, `findOneOrFail`)
and the QueryBuilder. Measured on vendure + twenty, the real call shapes are:
`find` (2673), `findOne` (649), `findOneBy` (45), `findAndCount` (11),
`findOneOrFail` (78), `count` (68), plus 322 `createQueryBuilder` with ~300
terminals. A dedicated adapter promotes these to high-confidence findings and
extracts `where`/`take` for `unbounded-read`, `over-fetch`, and cardinality.

## Scope (v1)

1. **Repository / manager find-options API** — full support.
   - Reads: `find`, `findOne`, `findOneBy`, `findBy`, `findAndCount`,
     `findAndCountBy`, `findOneOrFail`, `findOneByOrFail`, `count`, `countBy`.
   - Writes: `save`, `insert`, `update`, `upsert`, `increment`, `decrement`,
     `restore`. Deletes: `delete`, `remove`, `softDelete`, `softRemove`.
   - Extracts `hasFilter` (`where`), `hasLimit` (`take`), and filters.
2. **QueryBuilder terminals** — `getMany`, `getOne`, `getManyAndCount`,
   `getRawMany`, `getRawOne`, `getCount` recognized as reads (so `.getMany()` in
   a loop is an N+1), with `hasFilter`/`hasLimit` **unknown** (the fluent chain
   isn't parsed in v1), so they never yield a false `unbounded-read`.

## Disambiguation

TypeORM's `find`/`findOne` collide with Mongoose and arrays. Match only when
TypeORM is positively identifiable, via ANY of:

- a **TypeORM-signature read method** (`findOneBy`, `findBy`, `findAndCount`,
  `findAndCountBy`, `findOneOrFail`, `findOneByOrFail`, `countBy`) — any receiver;
- a **QueryBuilder terminal** (`getMany`/`getOne`/…) — any receiver;
- a **shared method** (`find`, `findOne`, `count`, and the write/delete methods)
  on a **repo-like receiver**, OR `find`/`findOne`/`count` with a capitalized
  **Entity identifier** first arg (`manager.find(User, …)`).

**repo-like receiver** =
- a `getRepository(X)` / `getTreeRepository(X)` / `getMongoRepository(X)` /
  `getCustomRepository(X)` call, or
- an identifier/property whose leaf ends in `Repository`/`Repo`, or is one of
  `manager`, `entityManager`, `em`, `connection`, `dataSource`,
  `transactionalEntityManager`.

This leaves `User.find({ active: true })` (Mongoose — no repo receiver, no
`where` wrapper) and `arr.find(cb)` to the other adapters.

## Filters, target, classification

- **Options-object form** (`find`, `findAndCount`, `findOne`, `count`): read the
  options object (2nd arg when the 1st is an Entity identifier, else 1st).
  `where` → `hasFilter` + filters; `take` → `hasLimit`. `where` uses
  `{ field: value }`; `In([...])` → `in`, other calls (`IsNull()`, `MoreThan()`)
  → `other`, literals → `eq`.
- **By-form** (`findOneBy`, `findBy`, `findAndCountBy`, `countBy`): the first arg
  **is** the where conditions — extract filters from it directly.
- **Opaque arg** (a variable/call, not an object literal) → `hasFilter`/`hasLimit`
  unknown (undefined), consistent with the Prisma/Mongoose adapters.
- **Single-row** (bounded, implicit limit): `findOne`, `findOneBy`,
  `findOneOrFail`, `findOneByOrFail`, `getOne`, `getRawOne`.
- **Aggregate**: `count`, `countBy`, `getCount`.
- **Target (entity)**: the Entity first arg (`manager.find(User, …)`) → `User`;
  else the `getRepository(X)` arg → `X`; else the receiver leaf with a trailing
  `Repository`/`Repo` stripped (`userRepository` → `user`); QB terminals → the
  createQueryBuilder alias if a string, else `unknown`.
- **confidence**: `high` (errors, like Prisma/Drizzle).

## Placement

Insert into the engine adapter chain **before Mongoose**:
`[drizzle, prisma, typeorm, mongoose, rawSql, heuristic]`. TypeORM's positive
identification means it won't steal Prisma (`prisma.model.findMany`), Drizzle
(`db.query…`), or Mongoose (`Model.find`) calls.

## Deferred to v2 (YAGNI)

Parsing the QueryBuilder chain (`.where('x.id = :id')` SQL string + chained
`.take()`) for filter/limit extraction. v1 already catches QB N+1s.

## Testing

Adapter unit tests: each read/write/delete method; where extraction (options and
by-forms); `In([])` → in; single-row bounding; aggregate; opaque arg → unknown;
`getRepository(X)`/`manager.find(Entity, …)`/`xxxRepository` targets; QB
terminals as reads with unknown filter/limit. Disambiguation: `User.find({...})`
(Mongoose) and `arr.find(cb)` return null. Engine integration: a TypeORM N+1 in a
loop is an error; an unfiltered `repo.find()` warns; Mongoose still works.
False-positive corpus: a repo write in a loop stays clean; QB `.getOne()` is
bounded.
