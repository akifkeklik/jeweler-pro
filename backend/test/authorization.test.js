const { inspect } = require('../testSupport/tenantInspection');
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const User = require('../models/User');
const Category = inspect(require('../models/Category'));
const AuditLog = require('../models/AuditLog');
const DeletedUser = require('../models/DeletedUser');
const app = require('../server');
const { signToken } = require('../middleware/auth');

const JWT_SECRET = 'test-secret-with-more-than-thirty-two-characters';

async function requestApp(method, path, user) {
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });
  try {
    const token = user && signToken(user);
    const address = server.address();
    return await new Promise((resolve, reject) => {
      const request = http.request({
        host: '127.0.0.1',
        port: address.port,
        method,
        path,
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      }, (response) => {
        response.resume();
        response.on('end', () => resolve({ statusCode: response.statusCode }));
      });
      request.on('error', reject);
      request.end();
    });
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

function makeUser(role = 'staff', id = '507f1f77bcf86cd799439011') {
  return {
    _id: id,
    email: `${role}@example.com`,
    role,
    active: true,
    tokenVersion: 0,
    businessId: 'jeweler_main_01',
    branch: 'Merkez Şube - Kapalıçarşı',
  };
}

test('rejects anonymous access before authorization checks', async () => {
  process.env.JWT_SECRET = JWT_SECRET;
  const response = await requestApp('DELETE', '/api/categories/1');
  assert.equal(response.statusCode, 401);
});

test('denies staff destructive operations and allows admin operations', async () => {
  process.env.JWT_SECRET = JWT_SECRET;
  const originalFindById = User.findById;
  const originalFindOneAndUpdate = Category.findOneAndUpdate;
  const users = {
    staff: makeUser('staff'),
    admin: makeUser('admin', '507f1f77bcf86cd799439012'),
  };
  User.findById = async (id) => Object.values(users).find((user) => user._id === String(id));
  Category.findOneAndUpdate = async () => ({ _id: 1, isArchived: true });
  try {
    const staffResponse = await requestApp('DELETE', '/api/categories/1', users.staff);
    const adminResponse = await requestApp('DELETE', '/api/categories/1', users.admin);

    assert.equal(staffResponse.statusCode, 403);
    assert.equal(adminResponse.statusCode, 200);
  } finally {
    User.findById = originalFindById;
    Category.findOneAndUpdate = originalFindOneAndUpdate;
  }
});

test('uses the current database role after a role downgrade', async () => {
  process.env.JWT_SECRET = JWT_SECRET;
  const user = makeUser('admin');
  const tokenUser = { ...user };
  const originalFindById = User.findById;
  const originalFindOneAndUpdate = Category.findOneAndUpdate;
  User.findById = async () => user;
  Category.findOneAndUpdate = async () => ({ _id: 1, isArchived: true });
  try {
    const beforeDowngrade = await requestApp('DELETE', '/api/categories/1', tokenUser);
    user.role = 'staff';
    const afterDowngrade = await requestApp('DELETE', '/api/categories/1', tokenUser);

    assert.equal(beforeDowngrade.statusCode, 200);
    assert.equal(afterDowngrade.statusCode, 403);
  } finally {
    User.findById = originalFindById;
    Category.findOneAndUpdate = originalFindOneAndUpdate;
  }
});

test('rejects inactive users and manipulated resource identifiers safely', async () => {
  process.env.JWT_SECRET = JWT_SECRET;
  const user = makeUser('staff');
  const originalFindById = User.findById;
  User.findById = async () => ({ ...user, active: false });
  try {
    const inactiveResponse = await requestApp('GET', '/api/categories/1', user);
    assert.equal(inactiveResponse.statusCode, 401);
  } finally {
    User.findById = originalFindById;
  }

  const originalActiveFindById = User.findById;
  User.findById = async () => user;
  try {
    const manipulatedResponse = await requestApp('GET', '/api/products/%24ne', user);
    assert.equal(manipulatedResponse.statusCode, 400);
  } finally {
    User.findById = originalActiveFindById;
  }
});

test('allows only admins to read audit records', async () => {
  process.env.JWT_SECRET = JWT_SECRET;
  const originalFindById = User.findById;
  const originalFind = AuditLog.find;
  const users = {
    staff: makeUser('staff'),
    admin: makeUser('admin', '507f1f77bcf86cd799439012'),
  };
  User.findById = async (id) => Object.values(users).find((user) => user._id === String(id));
  const originalUserFind = User.find;
  const originalDeletedFind = DeletedUser.find;
  const deletedActorId = '507f1f77bcf86cd799439099';
  let auditFilter;
  User.find = () => ({ select: () => ({ lean: async () => Object.values(users) }) });
  // A permanently deleted member of the same business keeps its audit trail.
  DeletedUser.find = () => ({ select: () => ({ lean: async () => [{ _id: deletedActorId }] }) });
  AuditLog.find = (filter) => (auditFilter = filter, {
    sort: () => ({
      limit: () => ({
        select: async () => [{ action: 'sale.created', resourceType: 'Sale', resourceId: '1' }],
      }),
    }),
  });
  try {
    const staffResponse = await requestApp('GET', '/api/audit', users.staff);
    const adminResponse = await requestApp('GET', '/api/audit', users.admin);

    assert.equal(staffResponse.statusCode, 403);
    assert.equal(adminResponse.statusCode, 200);
    // Audit records are restricted to actors of the caller's business.
    assert.deepEqual(
      auditFilter.actorUserId.$in.map(String),
      [...Object.values(users).map((u) => u._id), deletedActorId],
    );
  } finally {
    User.findById = originalFindById;
    User.find = originalUserFind;
    DeletedUser.find = originalDeletedFind;
    AuditLog.find = originalFind;
  }
});
