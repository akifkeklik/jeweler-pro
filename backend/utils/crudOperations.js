/**
 * Shared CRUD helpers with writable-field filtering.
 * Client input must never be allowed to set document IDs or audit metadata.
 */

const PROTECTED_FIELDS = new Set(["_id", "id", "__v", "createdAt", "updatedAt"]);

function writableData(Model, data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    const error = new Error("İstek gövdesi bir JSON nesnesi olmalıdır");
    error.statusCode = 400;
    throw error;
  }

  return Object.fromEntries(
    Object.entries(data).filter(([key]) =>
      !PROTECTED_FIELDS.has(key) &&
      !key.startsWith("$") &&
      Boolean(Model.schema.path(key))
    )
  );
}

/**
 * Generic GET all items
 */
async function getAll(Model) {
  return Model.find();
}

/**
 * Generic GET by ID
 */
async function getById(Model, id) {
  const item = await Model.findById(id);
  if (!item) {
    const error = new Error(`${Model.modelName} bulunamadı`);
    error.statusCode = 404;
    throw error;
  }
  return item;
}

/**
 * Generic CREATE
 */
async function create(Model, data) {
  const item = new Model(writableData(Model, data));
  return item.save();
}

/**
 * Generic UPDATE
 */
async function update(Model, id, data) {
  const safeData = writableData(Model, data);
  if (Object.keys(safeData).length === 0) {
    const error = new Error("Güncellenecek geçerli alan bulunamadı");
    error.statusCode = 400;
    throw error;
  }

  const item = await Model.findByIdAndUpdate(
    id,
    { $set: safeData },
    { new: true, runValidators: true, context: "query" }
  );

  if (!item) {
    const error = new Error(`${Model.modelName} bulunamadı`);
    error.statusCode = 404;
    throw error;
  }
  return item;
}

/**
 * Generic DELETE
 */
async function deleteItem(Model, id) {
  const item = await Model.findByIdAndDelete(id);
  if (!item) {
    const error = new Error(`${Model.modelName} bulunamadı`);
    error.statusCode = 404;
    throw error;
  }
  return item;
}

module.exports = {
  getAll,
  getById,
  create,
  update,
  deleteItem,
};
