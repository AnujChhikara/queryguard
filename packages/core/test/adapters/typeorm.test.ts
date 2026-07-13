import { describe, it, expect } from "vitest";
import { parseSource, findCallExpressions } from "../../src/parse.js";
import { typeormAdapter } from "../../src/adapters/typeorm.js";

function call(code: string, calleeText: string) {
  const sf = parseSource(code);
  return findCallExpressions(sf).find((c) => c.getExpression().getText() === calleeText)!;
}

describe("typeormAdapter", () => {
  it("recognizes repo.find({ where }) as a filtered read and extracts the entity", () => {
    const d = typeormAdapter(
      call(`async function r(userRepository){ await userRepository.find({ where: { status: "active" } }); }`, "userRepository.find"),
    );
    expect(d).not.toBeNull();
    expect(d!.orm).toBe("typeorm");
    expect(d!.operation).toBe("read");
    expect(d!.confidence).toBe("high");
    expect(d!.target).toBe("user");
    expect(d!.hasFilter).toBe(true);
    expect(d!.filters).toEqual([{ field: "status", value: "active", kind: "eq" }]);
  });

  it("treats a bare repo.find() as unfiltered and unlimited", () => {
    const d = typeormAdapter(call(`async function r(repo){ await repo.find(); }`, "repo.find"));
    expect(d).not.toBeNull();
    expect(d!.hasFilter).toBe(false);
    expect(d!.hasLimit).toBe(false);
  });

  it("reads take as a limit", () => {
    const d = typeormAdapter(
      call(`async function r(userRepository){ await userRepository.find({ where: { a: 1 }, take: 20 }); }`, "userRepository.find"),
    );
    expect(d!.hasLimit).toBe(true);
  });

  it("treats findOne as single-row (bounded)", () => {
    const d = typeormAdapter(
      call(`async function r(userRepository){ await userRepository.findOne({ where: { id: 1 } }); }`, "userRepository.findOne"),
    );
    expect(d!.operation).toBe("read");
    expect(d!.hasLimit).toBe(true);
  });

  it("extracts the where directly from findOneBy (by-form, no wrapper) and bounds it", () => {
    const d = typeormAdapter(call(`async function r(repo){ await repo.findOneBy({ email: "x@y.z" }); }`, "repo.findOneBy"));
    expect(d).not.toBeNull();
    expect(d!.hasLimit).toBe(true);
    expect(d!.filters).toEqual([{ field: "email", value: "x@y.z", kind: "eq" }]);
  });

  it("extracts the where directly from findBy and maps In([]) to an in-filter", () => {
    const d = typeormAdapter(call(`async function r(repo){ await repo.findBy({ id: In([1, 2]) }); }`, "repo.findBy"));
    expect(d).not.toBeNull();
    expect(d!.operation).toBe("read");
    expect(d!.filters).toEqual([{ field: "id", kind: "in" }]);
  });

  it("recognizes findAndCount as a read", () => {
    const d = typeormAdapter(call(`async function r(repo){ await repo.findAndCount({ where: { a: 1 } }); }`, "repo.findAndCount"));
    expect(d!.operation).toBe("read");
  });

  it("recognizes count as an aggregate read", () => {
    const d = typeormAdapter(call(`async function r(repo){ await repo.count(); }`, "repo.count"));
    expect(d!.operation).toBe("read");
    expect(d!.isAggregate).toBe(true);
  });

  it("takes the entity from getRepository(X).find()", () => {
    const d = typeormAdapter(
      call(`async function r(conn){ await conn.getRepository(User).find({ where: { a: 1 } }); }`, "conn.getRepository(User).find"),
    );
    expect(d).not.toBeNull();
    expect(d!.target).toBe("User");
  });

  it("takes the entity from manager.find(Entity, options)", () => {
    const d = typeormAdapter(
      call(`async function r(manager){ await manager.find(UserEntity, { where: { a: 1 }, take: 5 }); }`, "manager.find"),
    );
    expect(d).not.toBeNull();
    expect(d!.target).toBe("UserEntity");
    expect(d!.hasFilter).toBe(true);
    expect(d!.hasLimit).toBe(true);
  });

  it("recognizes a QueryBuilder getMany() terminal as a read with unknown filter/limit", () => {
    const d = typeormAdapter(
      call(`async function r(repo){ await repo.createQueryBuilder("u").where("u.id = :id", { id: 1 }).getMany(); }`, `repo.createQueryBuilder("u").where("u.id = :id", { id: 1 }).getMany`),
    );
    expect(d).not.toBeNull();
    expect(d!.operation).toBe("read");
    expect(d!.hasFilter).toBeUndefined();
    expect(d!.hasLimit).toBeUndefined();
  });

  it("treats getOne() as a single-row read", () => {
    const d = typeormAdapter(call(`async function r(qb){ await qb.getOne(); }`, "qb.getOne"));
    expect(d!.operation).toBe("read");
    expect(d!.hasLimit).toBe(true);
  });

  it("recognizes repo.save as a write and repo.softDelete as a delete", () => {
    const save = typeormAdapter(call(`async function r(userRepository, u){ await userRepository.save(u); }`, "userRepository.save"));
    expect(save!.operation).toBe("write");
    const del = typeormAdapter(call(`async function r(userRepository, id){ await userRepository.softDelete(id); }`, "userRepository.softDelete"));
    expect(del!.operation).toBe("delete");
  });

  it("reports unknown filter for an opaque options arg (variable)", () => {
    const d = typeormAdapter(call(`async function r(userRepository, opts){ await userRepository.find(opts); }`, "userRepository.find"));
    expect(d).not.toBeNull();
    expect(d!.hasFilter).toBeUndefined();
    expect(d!.hasLimit).toBeUndefined();
  });

  it("does NOT claim a Mongoose-style Model.find (no repo receiver, no where wrapper)", () => {
    expect(typeormAdapter(call(`async function r(User){ await User.find({ active: true }); }`, "User.find"))).toBeNull();
  });

  it("does NOT claim an array .find(callback)", () => {
    expect(typeormAdapter(call(`function r(arr){ return arr.find((x) => x.id === 1); }`, "arr.find"))).toBeNull();
  });

  it("does NOT claim a save on a non-repo receiver (mongoose document)", () => {
    expect(typeormAdapter(call(`async function r(doc){ await doc.save(); }`, "doc.save"))).toBeNull();
  });
});
