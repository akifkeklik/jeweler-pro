const test = require("node:test");
const assert = require("node:assert/strict");
const errorHandler = require("../middleware/errorHandler");

function mockResponse() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

test("unexpected production errors do not expose internal messages", () => {
  const previousEnv = process.env.NODE_ENV;
  const previousConsoleError = console.error;
  process.env.NODE_ENV = "production";
  console.error = () => {};

  try {
    const response = mockResponse();
    errorHandler(new Error("database password leaked"), {
      method: "GET",
      originalUrl: "/api/private",
    }, response);

    assert.equal(response.statusCode, 500);
    assert.equal(response.body.error, "Sunucuda beklenmeyen bir hata oluştu");
    assert.equal(JSON.stringify(response.body).includes("database password"), false);
  } finally {
    if (previousEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousEnv;
    console.error = previousConsoleError;
  }
});

test("duplicate key errors return conflict even without key metadata", () => {
  const previousConsoleError = console.error;
  console.error = () => {};

  try {
    const response = mockResponse();
    errorHandler(Object.assign(new Error("duplicate"), { code: 11000 }), {
      method: "POST",
      originalUrl: "/api/products",
    }, response);

    assert.equal(response.statusCode, 409);
    assert.match(response.body.error, /zaten kayıtlı/);
  } finally {
    console.error = previousConsoleError;
  }
});
