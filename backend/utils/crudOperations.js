/**
 * Shared CRUD helpers with writable-field filtering and soft-delete support.
 * Financial and customer history must remain referentially intact.
 */
const PROTECTED_FIELDS = new Set(["_id", "id", "__v", "createdAt", "updatedAt"]);

function hasArchive(Model) {
  return Boolean(Model.schema.path("isArchived"));
}

function writableData(Model, data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    const error = new Error("İstek gövdesi bir JSON nesnesi olmalıdır");
    error.statusCode = 400;
    throw error;
  }

  return Object.fromEntries(
    Object.entries(data).filter(([key]) =>
      !PROTECTED_FIELDS.has(key) &&
      key !== "isArchived" &&
      !key.startsWith("$") &&
      Boolean(Model.schema.path(key))
    )
  );
}

async function getAll(Model) {
  return Model.find(hasArchive(Model) ? { isArchived: { $ne: true } } : {});
}

async function getById(Model, id) {
  const item = hasArchive(Model)
    ? await Model.findOne({ _id: id, isArchived: { $ne: true } })
    : await Model.findById(id);
  if (!item) {
    const error = new Error(`${Model.modelName} bulunamadı`);
    error.statusCode = 404;
    throw error;
  }
  return item;
}

async function create(Model, data) {
  const item = new Model(writableData(Model, data));
  return item.save();
}

async function update(Model, id, data) {
  const safeData = writableData(Model, data);
  if (Object.keys(safeData).length === 0) {
    const error = new Error("Güncellenecek geçerli alan bulunamadı");
    error.statusCode = 400;
    throw error;
  }

  const options = { new: true, runValidators: true, context: "query" };
  const item = hasArchive(Model)
    ? await Model.findOneAndUpdate({ _id: id, isArchived: { $ne: true } }, { $set: safeData }, options)
    : await Model.findByIdAndUpdate(id, { $set: safeData }, options);

  if (!item) {
    const error = new Error(`${Model.modelName} bulunamadı`);
    error.statusCode = 404;
    throw error;
  }
  return item;
}

async function deleteItem(Model, id) {
  const item = hasArchive(Model)
    ? await Model.findOneAndUpdate(
      { _id: id, isArchived: { $ne: true } },
      { $set: { isArchived: true } },
      { new: true }
    )
    : await Model.findByIdAndDelete(id);

  if (!item) {
    const error = new Error(`${Model.modelName} bulunamadı`);
    error.statusCode = 404;
    throw error;
  }
  return item;
}

module.exports = { getAll, getById, create, update, deleteItem, writableData };
