const test = require("node:test");
const assert = require("node:assert/strict");
const { update } = require("../utils/crudOperations");

test("generic updates ignore protected and unknown fields", async () => {
  let captured;
  const allowed = new Set(["name", "price", "stock"]);
  const Model = {
    modelName: "Product",
    schema: { path: (key) => allowed.has(key) ? {} : undefined },
    findByIdAndUpdate: async (id, updateDoc, options) => {
      captured = { id, updateDoc, options };
      return { id };
    },
  };

  await update(Model, "123", {
    name: "Updated",
    price: 125,
    _id: 999,
    createdAt: "2000-01-01",
    __v: 99,
    $set: { stock: 999 },
    unknownField: "ignored",
  });

  assert.equal(captured.id, "123");
  assert.deepEqual(captured.updateDoc, { $set: { name: "Updated", price: 125 } });
  assert.equal(captured.options.runValidators, true);
});

test("generic updates reject an empty writable payload", async () => {
  const Model = {
    modelName: "Product",
    schema: { path: () => undefined },
    findByIdAndUpdate: async () => { throw new Error("should not be called"); },
  };

  await assert.rejects(
    update(Model, "123", { _id: 456, __v: 10 }),
    (error) => error.statusCode === 400
  );
});
