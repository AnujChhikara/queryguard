import { describe, it, expect } from "vitest";
import { parseSource, findCallExpressions } from "../../src/parse.js";
import { mongooseAdapter } from "../../src/adapters/mongoose.js";

function firstCall(code: string, calleeText: string) {
  const sf = parseSource(code);
  return findCallExpressions(sf).find((c) => c.getExpression().getText() === calleeText)!;
}

describe("mongooseAdapter", () => {
  it("recognizes Model.find with a filter object", () => {
    const call = firstCall(`async function r(){ await User.find({ active: true }); }`, "User.find");
    const d = mongooseAdapter(call);
    expect(d).not.toBeNull();
    expect(d!.orm).toBe("mongoose");
    expect(d!.operation).toBe("read");
    expect(d!.target).toBe("User");
    expect(d!.confidence).toBe("high");
    expect(d!.hasFilter).toBe(true);
    expect(d!.hasLimit).toBe(false);
    expect(d!.isAggregate).toBe(false);
  });

  it("treats an empty/absent filter as no filter", () => {
    const call = firstCall(`async function r(){ await User.find(); }`, "User.find");
    const d = mongooseAdapter(call);
    expect(d!.hasFilter).toBe(false);
  });

  it("detects a chained .limit() as hasLimit", () => {
    const call = firstCall(`async function r(){ await User.find({ active: true }).limit(10); }`, "User.find");
    expect(mongooseAdapter(call)!.hasLimit).toBe(true);
  });

  it("classifies countDocuments as an aggregate read", () => {
    const call = firstCall(`async function r(){ await User.countDocuments({ active: true }); }`, "User.countDocuments");
    const d = mongooseAdapter(call);
    expect(d!.operation).toBe("read");
    expect(d!.isAggregate).toBe(true);
  });

  it("classifies writes and deletes", () => {
    const create = firstCall(`async function r(){ await User.create({ name: "a" }); }`, "User.create");
    expect(mongooseAdapter(create)!.operation).toBe("write");
    const del = firstCall(`async function r(){ await User.deleteMany({ old: true }); }`, "User.deleteMany");
    expect(mongooseAdapter(del)!.operation).toBe("delete");
  });

  it("recognizes findById as an always-filtered read", () => {
    const call = firstCall(`async function r(id){ await User.findById(id); }`, "User.findById");
    const d = mongooseAdapter(call);
    expect(d!.operation).toBe("read");
    expect(d!.hasFilter).toBe(true);
  });

  it("accepts a model accessed via property (this.userModel)", () => {
    const call = firstCall(`async function r(){ await this.userModel.findOne({ id: 1 }); }`, "this.userModel.findOne");
    const d = mongooseAdapter(call);
    expect(d).not.toBeNull();
    expect(d!.target).toBe("userModel");
  });

  it("does NOT match Array.prototype.find with a callback", () => {
    const call = firstCall(`async function r(items){ return items.find((x) => x.id === 1); }`, "items.find");
    expect(mongooseAdapter(call)).toBeNull();
  });

  it("does NOT match .find on a lowercase, non-model receiver", () => {
    const call = firstCall(`async function r(list){ return list.find({ id: 1 }); }`, "list.find");
    expect(mongooseAdapter(call)).toBeNull();
  });
});
