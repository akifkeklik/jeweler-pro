const test = require("node:test");
const assert = require("node:assert/strict");

const mongoose = require("mongoose");
const Product = require("../models/Product");
const Sale = require("../models/Sale");
const Category = require("../models/Category");
const Customer = require("../models/Customer");
const Material = require("../models/Material");

async function assertGeneratedId(Model, payload) {
  const originalExists = Model.exists;
  Model.exists = async () => null;

  try {
    const document = new Model(payload);
    await document.validate();
    assert.equal(typeof document._id, "number");
    assert.ok(document._id > 0);
  } finally {
    Model.exists = originalExists;
  }
}

test("numeric IDs are generated before required-field validation", async () => {
  await assertGeneratedId(Product, {
    name: "Test ring",
    slug: "test-ring",
    sku: "RING-001",
    price: 100,
  });

  await assertGeneratedId(Sale, {
    customerId: 10000001,
    productId: 100001,
    totalPrice: 100,
  });

  await assertGeneratedId(Category, { name: "Gold" });
  await assertGeneratedId(Customer, { name: "Test customer" });
  await assertGeneratedId(Material, { name: "Gold" });
});
