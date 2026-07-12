// Cardinal anti-pattern sampler — Prisma, Drizzle, Mongoose, raw SQL.
// Run:  node packages/cli/dist/bin.js "examples/anti-patterns.ts"
// (Each block is annotated with the diagnostic Cardinal should report.)

// ─────────────────────────────────────────────────────────────
// PRISMA
// ─────────────────────────────────────────────────────────────

// n-plus-one (error): a query per user
async function prismaNPlusOne(prisma: any, users: any[]) {
  for (const user of users) {
    await prisma.post.findMany({ where: { authorId: user.id } });
  }
}

// unbounded-read (warning): no where, no take
async function prismaUnbounded(prisma: any) {
  return prisma.user.findMany();
}

// ─────────────────────────────────────────────────────────────
// DRIZZLE (relational query API)
// ─────────────────────────────────────────────────────────────

// n-plus-one (error)
async function drizzleNPlusOne(db: any, users: any[]) {
  for (const u of users) {
    await db.query.posts.findMany({ where: { authorId: u.id } });
  }
}

// unbounded-read (warning)
async function drizzleUnbounded(db: any) {
  return db.query.users.findMany();
}

// ─────────────────────────────────────────────────────────────
// MONGOOSE
// ─────────────────────────────────────────────────────────────

// n-plus-one (error): one findById per id
async function mongooseNPlusOne(ids: string[]) {
  for (const id of ids) {
    await User.findById(id);
  }
}

// unbounded-read (warning): find() with no filter, no limit
async function mongooseUnbounded() {
  return User.find();
}

// NOT flagged: real Array.prototype.find (has a callback)
function notAQuery(items: any[]) {
  return items.find((x) => x.id === 1);
}

// ─────────────────────────────────────────────────────────────
// RAW SQL
// ─────────────────────────────────────────────────────────────

// n-plus-one (error): a query per id
async function rawNPlusOne(sql: any, ids: number[]) {
  for (const id of ids) {
    await sql`SELECT * FROM orders WHERE user_id = ${id}`;
  }
}

// unbounded-read (warning): SELECT with no WHERE and no LIMIT
async function rawUnbounded(sql: any) {
  await sql`SELECT * FROM users`;
}

// NOT flagged: bounded read (has WHERE and LIMIT)
async function rawClean(sql: any, id: number) {
  await sql`SELECT id, name FROM users WHERE id = ${id} LIMIT 1`;
}

declare const User: any;
